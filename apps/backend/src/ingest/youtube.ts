import type { Comment } from '@creatorsignal/shared'
import type { Store } from '../db.js'

interface ThreadItem {
  id: string
  snippet: {
    topLevelComment: {
      snippet: {
        authorDisplayName: string
        authorChannelId?: { value?: string }
        textDisplay: string
        publishedAt: string
      }
    }
  }
}

/**
 * YouTube Data API v3 client. Incremental by cursor: for every video we keep
 * the newest publishedAt we have seen in channel_state and only pull comment
 * threads newer than that on the next run.
 */
export class YoutubeIngestor {
  constructor(
    private readonly apiKey: string,
    private readonly videoIds: string[],
    private readonly channelId: string | undefined,
    private readonly daysBack: number,
  ) {}

  async resolveVideoIds(): Promise<string[]> {
    if (this.videoIds.length > 0) return this.videoIds
    if (!this.channelId) return []
    const channels = await this.getJson(
      'channels',
      { part: 'contentDetails', id: this.channelId },
    )
    const uploads = channels?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads as
      | string
      | undefined
    if (!uploads) return []
    const playlist = await this.getJson('playlistItems', {
      part: 'contentDetails',
      playlistId: uploads,
      maxResults: '50',
    })
    const ids: string[] = []
    for (const item of playlist?.items ?? []) {
      const videoId = item?.contentDetails?.videoId as string | undefined
      if (videoId) ids.push(videoId)
    }
    return ids
  }

  /** Pulls new comments for all known videos and stores them. */
  async ingestNew(store: Store): Promise<Comment[]> {
    const videos = await this.resolveVideoIds()
    const inserted: Comment[] = []
    for (const videoId of videos) {
      inserted.push(...(await this.ingestVideo(store, videoId)))
    }
    return inserted
  }

  private async ingestVideo(store: Store, videoId: string): Promise<Comment[]> {
    const cursorKey = `cursor:${videoId}`
    const cursor = store.getChannelState(cursorKey)
    const publishedAfter =
      cursor ?? new Date(Date.now() - this.daysBack * 86_400_000).toISOString()
    const inserted: Comment[] = []
    let pageToken: string | undefined

    for (let page = 0; page < 10; page++) {
      const params: Record<string, string> = {
        part: 'snippet',
        videoId,
        maxResults: '100',
        textFormat: 'plainText',
        publishedAfter,
      }
      if (pageToken) params.pageToken = pageToken
      const data = await this.getJson('commentThreads', params)
      const items = (data?.items ?? []) as ThreadItem[]
      for (const item of items) {
        const snippet = item?.snippet?.topLevelComment?.snippet
        if (!snippet) continue
        const comment: Comment = {
          id: item.id,
          videoId,
          authorId: snippet.authorChannelId?.value ?? `yt:${videoId}:${snippet.authorDisplayName}`,
          authorName: snippet.authorDisplayName,
          text: snippet.textDisplay.replace(/\n/g, ' ').slice(0, 500),
          publishedAt: snippet.publishedAt,
          ingestedAt: new Date().toISOString(),
        }
        if (store.insertComment(comment)) inserted.push(comment)
      }
      pageToken = data?.nextPageToken as string | undefined
      if (!pageToken) break
    }

    if (inserted.length > 0) {
      const newest = inserted
        .map((c) => c.publishedAt)
        .sort()
        .at(-1)
      if (newest) store.setChannelState(cursorKey, newest)
    }
    return inserted
  }

  private async getJson(
    resource: string,
    params: Record<string, string>,
  ): Promise<{ items?: unknown[]; nextPageToken?: string } | undefined> {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`)
    url.searchParams.set('key', this.apiKey)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`youtube ${resource} failed: ${response.status} ${await response.text()}`)
    }
    return (await response.json()) as { items?: unknown[]; nextPageToken?: string }
  }
}
