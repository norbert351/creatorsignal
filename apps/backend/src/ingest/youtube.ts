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

interface ChannelItem {
  contentDetails?: { relatedPlaylists?: { uploads?: string } }
}

interface PlaylistItem {
  contentDetails?: { videoId?: string }
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

  async resolveVideoIds(extra?: { channelId?: string; videoIds: string[] }): Promise<string[]> {
    const ids = new Set(this.videoIds)
    for (const id of extra?.videoIds ?? []) ids.add(id)
    const channelId = extra?.channelId ?? this.channelId
    if (channelId) {
      const channels = await this.getJson(
        'channels',
        { part: 'contentDetails', id: channelId },
      )
      const channelItems = (channels?.items ?? []) as ChannelItem[]
      const uploads = channelItems[0]?.contentDetails?.relatedPlaylists?.uploads
      if (uploads) {
        const playlist = await this.getJson('playlistItems', {
          part: 'contentDetails',
          playlistId: uploads,
          maxResults: '50',
        })
        for (const item of (playlist?.items ?? []) as PlaylistItem[]) {
          const videoId = item?.contentDetails?.videoId
          if (videoId) ids.add(videoId)
        }
      }
    }
    return [...ids]
  }

  /** Pulls new comments for all known videos and stores them. */
  async ingestNew(store: Store, userId = 'local'): Promise<Comment[]> {
    // Merge per-creator targets stored via the onboarding API (added live,
    // no restart needed), scoped to the owning user's workspace. Channel
    // targets expand to the uploads playlist.
    const dbTargets = store.listTargets(userId).filter((t) => t.platform === 'youtube')
    const extra = {
      channelId: dbTargets.find((t) => t.kind === 'channel')?.value,
      videoIds: dbTargets.filter((t) => t.kind === 'video').map((t) => t.value),
    }
    const videos = await this.resolveVideoIds(extra)
    await this.cacheVideoTitles(store, videos)
    const inserted: Comment[] = []
    for (const videoId of videos) {
      try {
        inserted.push(...(await this.ingestVideo(store, videoId, userId)))
      } catch (error) {
        // A single video (e.g. comments disabled) must never kill the run.
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[youtube] skipping video ${videoId}: ${message}`)
      }
    }
    return inserted
  }

  /**
   * Resolve titles for all known video ids (batched, max 50 per call) and
   * cache them so the viewer can show which video each signal came from.
   */
  private async cacheVideoTitles(store: Store, videoIds: string[]): Promise<void> {
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50)
      try {
        const data = await this.getJson('videos', {
          part: 'snippet',
          id: batch.join(','),
        })
        for (const item of (data?.items ?? []) as Array<{ id?: string; snippet?: { title?: string } }>) {
          if (!item.id) continue
          store.upsertVideo({
            videoId: item.id,
            platform: 'youtube',
            title: item.snippet?.title?.slice(0, 120) ?? item.id,
            url: `https://www.youtube.com/watch?v=${item.id}`,
          })
        }
      } catch (error) {
        // Title resolution is a nice-to-have; never block comment ingest.
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[youtube] title cache failed: ${message}`)
      }
    }
  }

  private async ingestVideo(store: Store, videoId: string, userId = 'local'): Promise<Comment[]> {
    const cursorKey = `cursor:${videoId}`
    const cursor = store.getChannelState(cursorKey, userId)
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
          platform: 'youtube',
          videoId,
          authorId: snippet.authorChannelId?.value ?? `yt:${videoId}:${snippet.authorDisplayName}`,
          authorName: snippet.authorDisplayName,
          text: snippet.textDisplay.replace(/\n/g, ' ').slice(0, 500),
          publishedAt: snippet.publishedAt,
          ingestedAt: new Date().toISOString(),
        }
        if (store.insertComment(comment, userId)) inserted.push(comment)
      }
      pageToken = data?.nextPageToken as string | undefined
      if (!pageToken) break
    }

    if (inserted.length > 0) {
      const newest = inserted
        .map((c) => c.publishedAt)
        .sort()
        .at(-1)
      if (newest) store.setChannelState(cursorKey, newest, userId)
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
