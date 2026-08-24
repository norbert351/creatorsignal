import type { Digest, Opportunity } from '@creatorsignal/shared'
import type { Store } from './db.js'
import type { ContentBrief } from './brief.js'

/**
 * Telegram push notifier.
 *
 * The Mind runs locally (simulated gateway) and this class is its delivery
 * channel: when the creator connects a bot token + group in the web
 * onboarding, opportunity cards and the daily digest get pushed there.
 *
 * No separate bot process or webhook host is needed — this is plain
 * outbound HTTP to api.telegram.org from the same backend process.
 */

export const TELEGRAM_SETTINGS_KEYS = {
  botToken: 'telegram.bot_token',
  groupId: 'telegram.group_id',
  botName: 'telegram.bot_name',
  chatTitle: 'telegram.chat_title',
} as const

const API_BASE = 'https://api.telegram.org/bot'

export interface TelegramStatus {
  enabled: boolean
  botName: string | null
  groupIdMasked: string | null
  chatTitle: string | null
}

export interface ConnectResult {
  ok: boolean
  botName: string
  chatTitle: string | null
  error?: string
}

/** Normalize what a creator pastes into a chat_id Telegram accepts. */
export function resolveChatId(input: string): string {
  const trimmed = input.trim()
  if (/^-?\d+$/.test(trimmed)) return trimmed // numeric chat id
  let handle = trimmed.replace(/^https?:\/\/(t|telegram)\.me\//, '').replace(/^t\.me\//, '')
  handle = handle.split('/')[0] ?? handle // strip any message link suffix
  if (!handle.startsWith('@')) handle = `@${handle}`
  return handle
}

export function maskToken(token: string): string {
  if (token.length <= 8) return '••••'
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export interface TelegramNotifierOptions {
  store: Store
  /** Optional env-level fallback token (CREATORSIGNAL_TELEGRAM_BOT_TOKEN). */
  fallbackBotToken?: string
  /** Default user id for the single-creator demo workspace. */
  userId?: string
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
}

export class TelegramNotifier {
  private readonly store: Store
  private readonly fallbackBotToken: string | undefined
  private readonly userId: string
  private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void

  constructor(options: TelegramNotifierOptions) {
    this.store = options.store
    this.fallbackBotToken = options.fallbackBotToken
    this.userId = options.userId ?? 'local'
    this.log = options.log ?? ((level, message) => console.log(`[telegram] ${level}: ${message}`))
  }

  /** Resolve the user whose push settings to read/write. */
  private resolveUser(userId?: string): string {
    return userId ?? this.userId
  }

  getSettings(userId?: string): { botToken: string | null; groupId: string | null } {
    const uid = this.resolveUser(userId)
    const stored = this.store.listSettings(uid)
    const botToken = stored[TELEGRAM_SETTINGS_KEYS.botToken] ?? this.fallbackBotToken ?? null
    const groupId = stored[TELEGRAM_SETTINGS_KEYS.groupId] ?? null
    return { botToken, groupId }
  }

  status(userId?: string): TelegramStatus {
    const uid = this.resolveUser(userId)
    const { botToken, groupId } = this.getSettings(uid)
    const stored = this.store.listSettings(uid)
    return {
      enabled: Boolean(botToken && groupId),
      botName: stored[TELEGRAM_SETTINGS_KEYS.botName] ?? null,
      groupIdMasked: groupId ? resolveChatId(groupId) : null,
      chatTitle: stored[TELEGRAM_SETTINGS_KEYS.chatTitle] ?? null,
    }
  }

  /**
   * Validate a bot token against the live Telegram API, persist the config,
   * and send a test message into the group so the creator sees it work.
   */
  async connect(botToken: string, groupIdRaw: string, userId?: string): Promise<ConnectResult> {
    const uid = this.resolveUser(userId)
    const groupId = resolveChatId(groupIdRaw)
    const bot = await this.callApi<{ username?: string; first_name?: string }>(
      botToken,
      'getMe',
      {},
    )
    if (!bot) return { ok: false, botName: '', chatTitle: null, error: 'invalid bot token' }
    const botName = bot.username ?? bot.first_name ?? 'bot'

    let chatTitle: string | null = null
    try {
      const chat = await this.callApi<{ title?: string; username?: string }>(
        botToken,
        'getChat',
        { chat_id: groupId },
      )
      chatTitle = chat?.title ?? chat?.username ?? null
    } catch (error) {
      this.log('warn', `getChat failed for ${groupId}: ${errorMessage(error)}`)
    }

    this.store.setSetting(uid, TELEGRAM_SETTINGS_KEYS.botToken, botToken)
    this.store.setSetting(uid, TELEGRAM_SETTINGS_KEYS.groupId, groupId)
    this.store.setSetting(uid, TELEGRAM_SETTINGS_KEYS.botName, botName)
    if (chatTitle) this.store.setSetting(uid, TELEGRAM_SETTINGS_KEYS.chatTitle, chatTitle)

    const welcome = [
      '<b>CreatorSignal Mind connected</b> 🎙',
      '',
      `Bot: @${esc(botName)}`,
      `Group: ${esc(chatTitle ?? groupId)}`,
      '',
      'New opportunity cards and the daily digest will land here.',
    ].join('\n')
    const sent = await this.sendRaw(botToken, groupId, welcome)
    if (!sent) this.log('warn', 'test message send failed (group may not allow bot messages)')

    this.log('info', `connected as @${botName} → ${chatTitle ?? groupId}`)
    return { ok: true, botName, chatTitle }
  }

  disconnect(userId?: string): void {
    const uid = this.resolveUser(userId)
    for (const key of Object.values(TELEGRAM_SETTINGS_KEYS)) {
      this.store.deleteSetting(uid, key)
    }
    this.log('info', 'disconnected')
  }

  /** Push a card for a newly detected opportunity. No-op when not configured. */
  async opportunityCreated(opportunity: Opportunity, userId?: string): Promise<void> {
    const { botToken, groupId } = this.getSettings(this.resolveUser(userId))
    if (!botToken || !groupId) return
    const card = [
      `🎯 <b>New opportunity: ${esc(opportunity.topicLabel)}</b>`,
      '',
      `Demand score <b>${Math.round(opportunity.demandScore)}</b> · ${opportunity.repeatCount} repeat${
        opportunity.repeatCount === 1 ? '' : 's'
      } · ${opportunity.videoCount} video${opportunity.videoCount === 1 ? '' : 's'}`,
      opportunity.unanswered
        ? '⚠ Unanswered — your audience is asking and nobody has answered'
        : 'Audience is talking about this',
      '',
      `Key: <code>${esc(opportunity.topic)}</code>`,
    ].join('\n')
    const sent = await this.send(botToken, groupId, card)
    if (sent) this.log('info', `pushed opportunity card "${opportunity.topicLabel}"`)
  }

  /** Push the daily digest. No-op when not configured. */
  async digest(digest: Digest, userId?: string): Promise<void> {
    const { botToken, groupId } = this.getSettings(this.resolveUser(userId))
    if (!botToken || !groupId || digest.items.length === 0) return
    const lines = ['📋 <b>Daily digest</b> — what your audience wants next', '']
    for (const item of digest.items) {
      lines.push(`<b>${esc(item.title)}</b> · score ${Math.round(item.score)}`)
      if (item.body) lines.push(esc(item.body))
      lines.push('')
    }
    const sent = await this.send(botToken, groupId, lines.join('\n').trim())
    if (sent) this.log('info', `pushed digest with ${digest.items.length} items`)
  }

  /** Push the weekly content brief. No-op when not configured. */
  async brief(brief: ContentBrief, userId?: string): Promise<void> {
    const { botToken, groupId } = this.getSettings(this.resolveUser(userId))
    if (!botToken || !groupId) return
    if (brief.items.length === 0) {
      this.log('info', 'brief: nothing to push (no open opportunities)')
      return
    }
    const lines = [
      `📝 <b>Weekly content brief</b> — ${esc(brief.period)}`,
      esc(brief.headline),
      '',
    ]
    brief.items.forEach((item, index) => {
      const askers = item.askers.length > 0 ? ` · asked by ${esc(item.askers.join(', '))}` : ''
      lines.push(
        `${index + 1}. <b>${esc(item.topicLabel)}</b> — score ${Math.round(item.demandScore)}, ${item.repeatCount} repeat${item.repeatCount === 1 ? '' : 's'}${askers}`,
        esc(item.angle),
        '',
      )
    })
    const sent = await this.send(botToken, groupId, lines.join('\n').trim())
    if (sent) this.log('info', `pushed weekly brief with ${brief.items.length} items`)
  }

  // -------------------------------------------------------------------------
  // Telegram API
  // -------------------------------------------------------------------------

  private async send(
    botToken: string,
    groupId: string,
    text: string,
  ): Promise<boolean> {
    return this.sendRaw(botToken, groupId, text)
  }

  private async sendRaw(botToken: string, groupId: string, text: string): Promise<boolean> {
    try {
      await this.callApi(botToken, 'sendMessage', {
        chat_id: groupId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })
      return true
    } catch (error) {
      this.log('warn', `sendMessage failed: ${errorMessage(error)}`)
      return false
    }
  }

  private async callApi<T>(
    botToken: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<T | null> {
    const response = await fetch(`${API_BASE}${botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(`telegram ${method}: ${response.status} ${await response.text()}`)
    }
    const data = (await response.json()) as { ok: boolean; result?: T; description?: string }
    if (!data.ok) throw new Error(`telegram ${method}: ${data.description ?? 'error'}`)
    return data.result ?? null
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
