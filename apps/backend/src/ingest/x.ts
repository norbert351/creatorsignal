import type { Comment } from '@creatorsignal/shared'
import type { Store } from '../db.js'

interface XTweet {
  id: string
  text?: string
  created_at?: string
  author_id?: string
}

interface XUser {
  id?: string
  username?: string
  name?: string
}

/**
 * X (Twitter) API v2 client. Pulls recent tweets from a user timeline (or a
 * search query) and treats the replies/quotes as audience signals. Same
 * incremental-by-cursor contract as the YouTube and TikTok ingestors:
 * channel_state stores the newest id we have seen, and only records newer
 * than that are pulled on the next run. Requires a Bearer token.
 */
export class XIngestor {
  constructor(
    private readonly bearerToken: string,
    private readonly userIds: string[],
    private readonly query: string | undefined,
    private readonly daysBack: number,
  ) {}

  /** Pulls new tweets for all configured targets and stores them. */
  async ingestNew(store: Store, userId = 'local'): Promise<Comment[]> {
    // Merge per-creator targets stored via the onboarding API (live, no restart),
    // scoped to the owning user's workspace.
    const dbTargets = store.listTargets(userId).filter((t) => t.platform === 'x')
    const userIds = [...this.userIds, ...dbTargets.filter((t) => t.kind === 'user').map((t) => t.value)]
    const query = dbTargets.find((t) => t.kind === 'query')?.value ?? this.query
    const inserted: Comment[] = []
    const targets: Array<{ kind: 'user' | 'query'; value: string }> = []
    if (query) targets.push({ kind: 'query', value: query })
    for (const userId of userIds) targets.push({ kind: 'user', value: userId })
    for (const target of targets) {
      inserted.push(...(await this.ingestTarget(store, target, userId)))
    }
    return inserted
  }

  private async ingestTarget(
    store: Store,
    target: { kind: 'user' | 'query'; value: string },
    userId = 'local',
  ): Promise<Comment[]> {
    const cursorKey = `cursor:x:${target.kind}:${target.value}`
    const cursor = store.getChannelState(cursorKey, userId)
    const sinceTime = cursor ?? new Date(Date.now() - this.daysBack * 86_400_000).toISOString()
    const inserted: Comment[] = []
    let nextToken: string | undefined

    for (let page = 0; page < 10; page++) {
      const params: Record<string, string> = {
        'tweet.fields': 'text,created_at,author_id',
        'user.fields': 'username,name',
        max_results: '100',
        'start_time': sinceTime.slice(0, 19) + 'Z',
        expansions: 'author_id',
      }
      if (nextToken) params.pagination_token = nextToken

      let data:
        | { data?: unknown[]; includes?: { users?: unknown[] }; meta?: { next_token?: string } }
        | undefined
      if (target.kind === 'user') {
        data = await this.getJson(`users/${target.value}/mentions`, params)
      } else {
        params.query = target.value
        data = await this.getJson('tweets/search/recent', params)
      }

      const users = new Map<string, XUser>()
      for (const u of (data?.includes?.users ?? []) as XUser[]) {
        if (u.id) users.set(u.id, u)
      }
      for (const item of (data?.data ?? []) as XTweet[]) {
        if (!item.id) continue
        const author = users.get(item.author_id ?? '')
        const comment: Comment = {
          id: `x:${item.id}`,
          platform: 'x',
          videoId: `${target.kind}:${target.value}`,
          authorId: author?.username ?? `x:${item.author_id ?? item.id}`,
          authorName: author?.name ?? author?.username ?? 'anonymous',
          text: (item.text ?? '').replace(/\n/g, ' ').slice(0, 500),
          publishedAt: item.created_at ?? new Date().toISOString(),
          ingestedAt: new Date().toISOString(),
        }
        if (store.insertComment(comment, userId)) inserted.push(comment)
      }
      nextToken = data?.meta?.next_token
      if (!nextToken) break
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
  ): Promise<{ data?: unknown[]; includes?: { users?: unknown[] }; meta?: { next_token?: string } } | undefined> {
    const url = new URL(`https://api.x.com/2/${resource}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.bearerToken}` },
    })
    if (!response.ok) {
      throw new Error(`x ${resource} failed: ${response.status} ${await response.text()}`)
    }
    return (await response.json()) as {
      data?: unknown[]
      includes?: { users?: unknown[] }
      meta?: { next_token?: string }
    }
  }
}
