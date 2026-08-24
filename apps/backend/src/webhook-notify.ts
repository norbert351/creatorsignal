import type { Digest, Opportunity } from '@creatorsignal/shared'
import type { Store } from './db.js'
import type { ContentBrief } from './brief.js'

/**
 * Webhook digest notifier — the "other channel" delivery.
 *
 * Where Telegram pushes to a group, this POSTs the same digest / brief /
 * opportunity payloads as JSON to any webhook the creator configures. That
 * covers email (Zapier/Make/IFTTT webhook → email), Slack, or a raw
 * endpoint. Real SMTP email is intentionally not hardcoded: the creator
 * points this at whatever bridge they already use.
 */

export const WEBHOOK_SETTINGS_KEY = 'webhook.url'

export interface WebhookStatus {
  enabled: boolean
  urlMasked: string | null
}

export interface WebhookNotifierOptions {
  store: Store
  userId?: string
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
}

export function maskUrl(url: string): string {
  const parsed = new URL(url)
  const host = parsed.hostname
  const path = parsed.pathname.length > 12 ? `${parsed.pathname.slice(0, 9)}…` : parsed.pathname
  return `${parsed.protocol}//${host}${path}`
}

export class WebhookNotifier {
  private readonly store: Store
  private readonly userId: string
  private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void

  constructor(options: WebhookNotifierOptions) {
    this.store = options.store
    this.userId = options.userId ?? 'local'
    this.log = options.log ?? ((level, message) => console.log(`[webhook] ${level}: ${message}`))
  }

  /** Resolve the user whose push settings to read/write. */
  private resolveUser(userId?: string): string {
    return userId ?? this.userId
  }

  getUrl(userId?: string): string | null {
    return this.store.getSetting(this.resolveUser(userId), WEBHOOK_SETTINGS_KEY)
  }

  status(userId?: string): WebhookStatus {
    const url = this.getUrl(this.resolveUser(userId))
    return { enabled: Boolean(url), urlMasked: url ? maskUrl(url) : null }
  }

  /** Validate the URL, persist it, and fire a test ping. */
  async connect(urlRaw: string, userId?: string): Promise<{ ok: boolean; urlMasked: string; error?: string }> {
    const uid = this.resolveUser(userId)
    let url: URL
    try {
      url = new URL(urlRaw.trim())
    } catch {
      return { ok: false, urlMasked: '', error: 'invalid url' }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, urlMasked: '', error: 'must be http(s)' }
    }
    this.store.setSetting(uid, WEBHOOK_SETTINGS_KEY, url.toString())
    const sent = await this.post({ kind: 'hello', message: 'CreatorSignal Mind connected 🎙' }, uid)
    if (!sent) this.log('warn', 'test ping failed')
    this.log('info', `connected webhook ${maskUrl(url.toString())}`)
    return { ok: true, urlMasked: maskUrl(url.toString()) }
  }

  disconnect(userId?: string): void {
    this.store.deleteSetting(this.resolveUser(userId), WEBHOOK_SETTINGS_KEY)
    this.log('info', 'disconnected')
  }

  /** POST the digest payload. No-op when not configured. */
  async digest(digest: Digest, userId?: string): Promise<void> {
    const uid = this.resolveUser(userId)
    if (!this.getUrl(uid) || digest.items.length === 0) return
    const sent = await this.post({ kind: 'digest', createdAt: digest.createdAt, items: digest.items }, uid)
    if (sent) this.log('info', `webhook digest with ${digest.items.length} items`)
  }

  /** POST the weekly content brief. No-op when not configured. */
  async brief(brief: ContentBrief, userId?: string): Promise<void> {
    const uid = this.resolveUser(userId)
    if (!this.getUrl(uid) || brief.items.length === 0) return
    const sent = await this.post({ kind: 'brief', period: brief.period, headline: brief.headline, items: brief.items }, uid)
    if (sent) this.log('info', `webhook brief with ${brief.items.length} items`)
  }

  /** POST a card for a newly detected opportunity. */
  async opportunityCreated(opportunity: Opportunity, userId?: string): Promise<void> {
    const uid = this.resolveUser(userId)
    if (!this.getUrl(uid)) return
    const sent = await this.post({
      kind: 'opportunity',
      topic: opportunity.topicLabel,
      demandScore: opportunity.demandScore,
      repeatCount: opportunity.repeatCount,
      videoCount: opportunity.videoCount,
      unanswered: opportunity.unanswered,
    }, uid)
    if (sent) this.log('info', `webhook opportunity "${opportunity.topicLabel}"`)
  }

  private async post(payload: Record<string, unknown>, userId?: string): Promise<boolean> {
    const url = this.getUrl(this.resolveUser(userId))
    if (!url) return false
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'creatorsignal', ...payload }),
      })
      if (!response.ok) {
        this.log('warn', `post failed: ${response.status}`)
        return false
      }
      return true
    } catch (error) {
      this.log('warn', `post failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
}
