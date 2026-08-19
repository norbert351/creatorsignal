import type { Comment } from '@creatorsignal/shared'
import type { Store } from '../db.js'

interface TikTokVideo {
  id: string
  create_time?: string
  desc?: string
}

interface TikTokCommentItem {
  comment_id: string
  video_id: string
  user?: { open_id?: string; display_name?: string; username?: string }
  text?: string
  create_time?: string
}

/**
 * TikTok Research API client (v2). Same incremental-by-cursor contract as the
 * YouTube ingestor: channel_state keeps the newest create_time we have seen
 * per video, and only comment records newer than that are pulled on the next
 * run. Requires a Research API key with comment-scope access.
 */
export class TiktokIngestor {
  constructor(
    private readonly apiKey: string,
    private readonly videoIds: string[],
    private readonly daysBack: number,
  ) {}

  /** Pulls new comments for all known videos and stores them. */
  async ingestNew(store: Store, userId = 'local'): Promise<Comment[]> {
    // Merge per-creator targets stored via the onboarding API (live, no restart),
    // scoped to the owning user's workspace.
    const dbTargets = store
      .listTargets(userId)
      .filter((t) => t.platform === 'tiktok' && t.kind === 'video')
    const videoIds = [...this.videoIds, ...dbTargets.map((t) => t.value)]
    const inserted: Comment[] = []
    for (const videoId of videoIds) {
      inserted.push(...(await this.ingestVideo(store, videoId, userId)))
    }
    return inserted
  }

  private async ingestVideo(store: Store, videoId: string, userId = 'local'): Promise<Comment[]> {
    const cursorKey = `cursor:tiktok:${videoId}`
    const cursor = store.getChannelState(cursorKey, userId)
    const publishedAfter =
      cursor ?? new Date(Date.now() - this.daysBack * 86_400_000).toISOString()
    const inserted: Comment[] = []
    let cursorToken: string | undefined

    for (let page = 0; page < 10; page++) {
      const params: Record<string, string> = {
        fields: 'comment_id,video_id,text,create_time,user.display_name,user.username,user.open_id',
        max_count: '100',
        start_date: publishedAfter.slice(0, 10),
      }
      if (cursorToken) params.cursor = cursorToken
      const data = await this.getJson('video/comment/list', videoId, params)
      const items = (data?.data?.comments ?? []) as TikTokCommentItem[]
      for (const item of items) {
        if (!item.comment_id) continue
        const comment: Comment = {
          id: `tt:${item.comment_id}`,
          platform: 'tiktok',
          videoId: item.video_id ?? videoId,
          authorId: item.user?.open_id ?? `tt:${item.user?.username ?? item.comment_id}`,
          authorName: item.user?.display_name ?? item.user?.username ?? 'anonymous',
          text: (item.text ?? '').replace(/\n/g, ' ').slice(0, 500),
          publishedAt: this.toIso(item.create_time),
          ingestedAt: new Date().toISOString(),
        }
        if (store.insertComment(comment, userId)) inserted.push(comment)
      }
      cursorToken = data?.data?.cursor
      if (!cursorToken) break
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

  private toIso(unixSeconds?: string): string {
    if (!unixSeconds) return new Date().toISOString()
    const seconds = Number(unixSeconds)
    if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString()
    return new Date(seconds * 1000).toISOString()
  }

  private async getJson(
    resource: string,
    videoId: string,
    params: Record<string, string>,
  ): Promise<{ data?: { comments?: unknown[]; cursor?: string }; error?: { message?: string } } | undefined> {
    const url = new URL(`https://open.tiktokapis.com/v2/research/${resource}`)
    url.searchParams.set('video_id', videoId)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.apiKey}` },
    })
    if (!response.ok) {
      throw new Error(`tiktok ${resource} failed: ${response.status} ${await response.text()}`)
    }
    return (await response.json()) as { data?: { comments?: unknown[]; cursor?: string }; error?: { message?: string } }
  }
}

export type { TikTokVideo }
