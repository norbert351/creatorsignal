import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { DECISION_VALUES } from '@creatorsignal/shared'
import { draftReply } from '@creatorsignal/mind-client'
import type { MindGateway } from '@creatorsignal/mind-client'
import { hashPassword, isEmail, newApiKey, verifyPassword } from './auth.js'
import type { Account } from './auth.js'
import { buildAuthorizeUrl, exchangeCode, googleConfigured } from './google-auth.js'
import type { Config } from './config.js'
import type { Store } from './db.js'
import type { PipelineDeps } from './pipeline.js'
import { runPipeline } from './pipeline.js'
import type { Stage } from './pipeline.js'
import { composeContentBrief } from './brief.js'
import type { TelegramNotifier } from './telegram-notify.js'
import type { WebhookNotifier } from './webhook-notify.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: Account
  }
}

const decisionBodySchema = z.object({
  decision: z.enum(DECISION_VALUES),
  note: z.string().max(500).default(''),
})

const pipelineBodySchema = z.object({
  stages: z
    .array(z.enum(['ingest', 'distill', 'relay']))
    .min(1)
    .default(['ingest', 'distill', 'relay']),
})

const profileBodySchema = z.object({
  name: z.string().min(1).max(80),
  handle: z.string().min(1).max(80),
})

const targetBodySchema = z.object({
  platform: z.enum(['youtube', 'tiktok', 'x', 'telegram']),
  kind: z.enum(['channel', 'video', 'user', 'query', 'group']),
  value: z.string().min(1).max(500),
})

const telegramConfigSchema = z.object({
  botToken: z.string().min(5).max(200),
  groupId: z.string().min(1).max(200),
})

const registerSchema = z.object({
  email: z.string().max(200),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(80),
  handle: z.string().min(1).max(80),
})

const loginSchema = z.object({
  email: z.string().max(200),
  password: z.string().min(1).max(200),
})

/** Single-creator workspace id when the viewer login gate is off. */
const DEFAULT_USER_ID = 'local'

/** The authenticated user id, or the legacy demo workspace when auth is off. */
function currentUser(request: { user?: Account }): string {
  return request.user ? request.user.userId : DEFAULT_USER_ID
}

interface VideoMeta {
  videoId: string
  platform: string
  title: string
  url: string
}

function videoMap(store: Store): Map<string, VideoMeta> {
  return new Map(store.listVideos().map((v) => [v.videoId, v]))
}

/** Attach the source video title + link to a comment or signal. */
function withVideo<T extends { videoId: string }>(
  item: T,
  videos: Map<string, VideoMeta>,
): T & { videoTitle: string | null; videoUrl: string | null } {
  const video = videos.get(item.videoId)
  return { ...item, videoTitle: video?.title ?? null, videoUrl: video?.url ?? null }
}

export interface ServerDeps {
  store: Store
  gateway: MindGateway
  pipelineDeps: PipelineDeps
  config: Config
  notify: TelegramNotifier
  webhookNotify?: WebhookNotifier
}

export function buildServer(deps: ServerDeps) {
  const { store, gateway, pipelineDeps, config, notify, webhookNotify } = deps
  const server = Fastify({ logger: { level: config.logLevel } })

  void server.register(cors, { origin: true })

  // Static viewer (pure client, no secrets). The dashboard lives at /viewer/,
  // the marketing landing at /.
  const viewerDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'viewer')
  void server.register(fastifyStatic, { root: viewerDir, prefix: '/viewer/' })
  server.get('/', async (_request, reply) => reply.sendFile('landing.html', viewerDir))

  const authEnabled = config.auth === 'on'
  if (authEnabled || config.apiToken) {
    server.addHook('onRequest', async (request, reply) => {
      const url = request.url
      if (url === '/health' || url.startsWith('/health')) return
      if (url === '/' || url.startsWith('/viewer/')) return
      if (authEnabled && url.startsWith('/api/auth/')) return
      const authz = request.headers.authorization ?? ''
      const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
      if (authEnabled && config.apiToken && token === config.apiToken) return
      if (authEnabled && token) {
        const account = store.getAccountByApiKey(token)
        if (account) {
          ;(request as FastifyRequest & { user?: Account }).user = account
          return
        }
      }
      if (!authEnabled && config.apiToken && token === config.apiToken) return
      return reply.code(401).send({ error: 'unauthorized' })
    })
  }

  server.get('/health', async (request) => {
    // Scoped stats: when a valid account token is present, report that
    // user's workspace; otherwise the (open/legacy) 'local' workspace.
    const authz = request.headers.authorization ?? ''
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
    const account = token ? store.getAccountByApiKey(token) : undefined
    return {
      ok: true,
      mindMode: gateway.mode,
      auth: config.auth === 'on',
      google: googleConfigured(config),
      stats: store.stats(account?.userId ?? DEFAULT_USER_ID),
    }
  })

  // -------------------------------------------------------------------------
  // Viewer login gate (accounts). Auth routes are exempt from the gate hook.
  // -------------------------------------------------------------------------

  server.post('/api/auth/register', async (request, reply) => {
    const body = registerSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues })
    }
    const { email, password, name, handle } = body.data
    if (!isEmail(email)) {
      return reply.code(400).send({ error: 'invalid_email' })
    }
    if (store.getAccountByEmail(email)) {
      return reply.code(409).send({ error: 'email_taken' })
    }
    const userId = randomUUID()
    const apiKey = newApiKey()
    const now = new Date().toISOString()
    store.upsertUser({ id: userId, name, handle, createdAt: now })
    const created = store.createAccount({
      userId,
      email,
      passwordHash: hashPassword(password),
      apiKey,
      createdAt: now,
    })
    if (!created) {
      return reply.code(409).send({ error: 'email_taken' })
    }
    store.insertCreatorMemory({
      id: randomUUID(),
      kind: 'preference',
      content: `creator account: ${name} (${handle})`,
      refId: userId,
      createdAt: now,
    })
    return { ok: true, token: apiKey, user: store.getUser(userId) }
  })

  server.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues })
    }
    const account = store.getAccountByEmail(body.data.email)
    if (!account || !verifyPassword(body.data.password, account.passwordHash)) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    return { ok: true, token: account.apiKey, user: store.getUser(account.userId) }
  })

  server.get('/api/auth/me', async (request, reply) => {
    const authz = request.headers.authorization ?? ''
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
    const account = token ? store.getAccountByApiKey(token) : null
    if (!account) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    return { ok: true, user: store.getUser(account.userId) }
  })

  server.post('/api/auth/logout', async (request, reply) => {
    const authz = request.headers.authorization ?? ''
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
    const account = token ? store.getAccountByApiKey(token) : null
    if (!account) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    // Rotate the key so the old token is instantly invalid.
    store.setAccountKey(account.userId, newApiKey())
    return { ok: true }
  })

  // -------------------------------------------------------------------------
  // Google OAuth (social login). Both routes are exempt from the gate hook
  // because they resolve an account themselves.
  // -------------------------------------------------------------------------

  server.get('/api/auth/google', async (request, reply) => {
    if (!googleConfigured(config)) {
      return reply.code(400).send({ error: 'google_not_configured' })
    }
    const origin = `${request.protocol}://${request.host}`
    return reply.redirect(buildAuthorizeUrl(config, origin).url)
  })

  server.get('/api/auth/google/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string }
    const origin = `${request.protocol}://${request.host}`
    if (!query.code || !query.state) {
      return reply.redirect(`${origin}/viewer/?google_error=missing_params`)
    }
    const result = await exchangeCode(config, query.code, query.state)
    if (!('email' in result)) {
      return reply.redirect(`${origin}/viewer/?google_error=${encodeURIComponent(result.error)}`)
    }
    const { email, name } = result
    let account = store.getAccountByEmail(email)
    if (!account) {
      const userId = randomUUID()
      const apiKey = newApiKey()
      const now = new Date().toISOString()
      store.upsertUser({ id: userId, name, handle: `@${email.split('@')[0]}`, createdAt: now })
      store.createAccount({
        userId,
        email,
        passwordHash: '', // OAuth accounts have no local password
        apiKey,
        createdAt: now,
      })
      store.insertCreatorMemory({
        id: randomUUID(),
        kind: 'preference',
        content: `creator account (google): ${name} (${email})`,
        refId: userId,
        createdAt: now,
      })
      account = store.getAccountByEmail(email)
    }
    if (!account) {
      return reply.redirect(`${origin}/viewer/?google_error=account_failed`)
    }
    // Sign the browser into the viewer with this account's API key.
    return reply.redirect(`${origin}/viewer/?google_token=${account.apiKey}`)
  })

  server.get('/api/signals', async (request) => {
    const query = z
      .object({
        kind: z.enum(['question', 'request', 'topic', 'praise', 'critique']).optional(),
        topic: z.string().max(500).optional(),
        limit: z.coerce.number().int().positive().max(500).optional(),
      })
      .parse(request.query)
    const userId = currentUser(request)
    let signals = store.listSignals(query.kind, userId)
    if (query.topic !== undefined) signals = signals.filter((s) => s.topic === query.topic)
    if (query.limit !== undefined) signals = signals.slice(-query.limit)
    const videos = videoMap(store)
    return { signals: signals.map((s) => withVideo(s, videos)) }
  })

  server.get('/api/comments', async (request) => {
    const query = z
      .object({
        videoId: z.string().optional(),
        limit: z.coerce.number().int().positive().max(500).optional(),
      })
      .parse(request.query)
    const userId = currentUser(request)
    let comments = store.listComments(query.videoId, userId)
    if (query.limit !== undefined) comments = comments.slice(0, query.limit)
    const videos = videoMap(store)
    return { comments: comments.map((c) => withVideo(c, videos)) }
  })

  server.get('/api/opportunities', async (request) => {
    const query = z
      .object({ status: z.enum(['open', 'proposed', 'approved', 'rejected', 'covered']).optional() })
      .parse(request.query)
    const userId = currentUser(request)
    const opportunities = store.listOpportunities(query.status, userId)
    const fans = store.listFans(0, userId)
    const byId = new Map(fans.map((f) => [f.authorId, f]))
    const enriched = opportunities.map((o) => ({
      ...o,
      relatedAuthors: o.relatedAuthorIds
        .map((id) => byId.get(id))
        .filter((f) => f !== undefined)
        .map((f) => ({ authorId: f.authorId, name: f.name, superfanScore: f.superfanScore })),
    }))
    return { opportunities: enriched }
  })

  server.post('/api/opportunities/:id/decision', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const body = decisionBodySchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues })
    }
    const userId = currentUser(request)
    const opportunity = store.getOpportunity(params.id, userId)
    if (!opportunity) {
      return reply.code(404).send({ error: 'not_found' })
    }
    const { decision, note } = body.data
    store.updateOpportunityStatus(opportunity.id, decision, userId)
    store.insertDecision({
      id: randomUUID(),
      opportunityId: opportunity.id,
      decision,
      note,
      createdAt: new Date().toISOString(),
    }, userId)
    store.insertCreatorMemory({
      id: randomUUID(),
      kind: 'decision',
      content: `${opportunity.topicLabel} (${opportunity.topic}): ${decision}`,
      refId: opportunity.id,
      createdAt: new Date().toISOString(),
    }, userId)
    await gateway.recordDecision(opportunity, decision, note)
    return { ok: true, opportunity: store.getOpportunity(opportunity.id, userId) }
  })

  server.get('/api/fans', async (request) => {
    const query = z
      .object({ minScore: z.coerce.number().int().min(0).max(100).optional() })
      .parse(request.query)
    return { fans: store.listFans(query.minScore ?? 0, currentUser(request)) }
  })

  // -------------------------------------------------------------------------
  // Creator onboarding: profile + connected targets
  // -------------------------------------------------------------------------

  server.get('/api/profile', async (request) => {
    const userId = currentUser(request)
    const user = store.getUser(userId)
    return { user, targets: store.listTargets(userId) }
  })

  server.post('/api/profile', async (request, reply) => {
    const body = profileBodySchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues })
    }
    const userId = currentUser(request)
    store.upsertUser({
      id: userId,
      name: body.data.name,
      handle: body.data.handle,
      createdAt: new Date().toISOString(),
    })
    store.insertCreatorMemory({
      id: randomUUID(),
      kind: 'preference',
      content: `creator profile: ${body.data.name} (${body.data.handle})`,
      refId: userId,
      createdAt: new Date().toISOString(),
    })
    return { user: store.getUser(userId), targets: store.listTargets(userId) }
  })

  server.post('/api/targets', async (request, reply) => {
    const body = targetBodySchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues })
    }
    const userId = currentUser(request)
    const target = {
      id: randomUUID(),
      userId,
      platform: body.data.platform,
      kind: body.data.kind,
      value: body.data.value,
      createdAt: new Date().toISOString(),
    }
    store.addTarget(target)
    store.insertCreatorMemory({
      id: randomUUID(),
      kind: 'preference',
      content: `connected ${target.platform} ${target.kind}: ${target.value}`,
      refId: target.id,
      createdAt: new Date().toISOString(),
    })
    return { ok: true, target, targets: store.listTargets(userId) }
  })

  server.delete('/api/targets/:id', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const removed = store.removeTarget(params.id)
    if (!removed) {
      return reply.code(404).send({ error: 'not_found' })
    }
    return { ok: true, targets: store.listTargets(currentUser(request)) }
  })

  // -------------------------------------------------------------------------
  // Telegram push config (web-configurable delivery channel)
  // -------------------------------------------------------------------------

  server.get('/api/settings/telegram', async () => {
    return { ok: true, ...notify.status() }
  })

  server.post('/api/settings/telegram', async (request, reply) => {
    const body = telegramConfigSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues })
    }
    try {
      const result = await notify.connect(body.data.botToken, body.data.groupId)
      if (!result.ok) {
        return reply.code(400).send({ error: 'invalid_bot_token', message: result.error })
      }
      return { ...result, ...notify.status() }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: 'telegram_connect_failed', message })
    }
  })

  server.delete('/api/settings/telegram', async () => {
    notify.disconnect()
    return { ok: true, ...notify.status() }
  })

  // -------------------------------------------------------------------------
  // Webhook digest config ("other channel": email bridge, Slack, raw HTTP)
  // -------------------------------------------------------------------------

  server.get('/api/settings/webhook', async () => {
    return { ok: true, ...(webhookNotify?.status() ?? { enabled: false, urlMasked: null }) }
  })

  server.post('/api/settings/webhook', async (request, reply) => {
    if (!webhookNotify) {
      return reply.code(400).send({ error: 'webhook_disabled' })
    }
    const body = z.object({ url: z.string().min(5).max(1000) }).safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues })
    }
    const result = await webhookNotify.connect(body.data.url)
    if (!result.ok) {
      return reply.code(400).send({ error: 'invalid_webhook_url', message: result.error })
    }
    return { ok: true, ...webhookNotify.status() }
  })

  server.delete('/api/settings/webhook', async () => {
    webhookNotify?.disconnect()
    return { ok: true, ...(webhookNotify?.status() ?? { enabled: false, urlMasked: null }) }
  })

  // -------------------------------------------------------------------------
  // Weekly content brief (autonomous "make this next" plan)
  // -------------------------------------------------------------------------

  server.get('/api/brief/latest', async (request) => {
    const entries = store.listCreatorMemory('brief', currentUser(request))
    if (entries.length === 0) return { ok: true, brief: null }
    try {
      return { ok: true, brief: JSON.parse(entries[0]!.content) as unknown }
    } catch {
      return { ok: true, brief: null }
    }
  })

  server.post('/api/brief/generate', async (request) => {
    const userId = currentUser(request)
    const brief = composeContentBrief(store, 3, userId)
    store.insertCreatorMemory({
      id: `brief-${brief.id}`,
      kind: 'brief',
      content: JSON.stringify(brief),
      refId: brief.id,
      createdAt: brief.generatedAt,
    }, userId)
    // Push to Telegram + webhook when connected (fire-and-forget).
    void notify.brief(brief)
    void webhookNotify?.brief(brief)
    return { ok: true, brief }
  })

  server.get('/api/memory', async (request) => {
    const query = z
      .object({
        kind: z
          .enum(['decision', 'covered', 'note', 'goal', 'preference', 'draft', 'brief'])
          .optional(),
      })
      .parse(request.query)
    return { memory: store.listCreatorMemory(query.kind, currentUser(request)) }
  })

  server.get('/api/digests', async (request) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(50).optional() }).parse(request.query)
    return { digests: store.listDigests(query.limit ?? 20, currentUser(request)) }
  })

  server.get('/api/drafts', async (request) => {
    const userId = currentUser(request)
    const fans = new Map(store.listFans(0, userId).map((f) => [f.authorId, f]))
    const opps = new Map(store.listOpportunities(undefined, userId).map((o) => [o.id, o]))
    const drafts = store.listCreatorMemory('draft', userId).map((entry) => {
      // refId is a fan authorId for fan-scoped drafts, an opportunity id when
      // scoped to an opportunity.
      const opportunity = entry.refId ? opps.get(entry.refId) : undefined
      const fan = entry.refId ? fans.get(entry.refId) : undefined
      return {
        id: entry.id,
        content: entry.content,
        refId: entry.refId,
        createdAt: entry.createdAt,
        fan: fan ? { authorId: fan.authorId, name: fan.name } : null,
        opportunity: opportunity
          ? { id: opportunity.id, topicLabel: opportunity.topicLabel }
          : null,
      }
    })
    return { drafts }
  })

  server.post('/api/reply-draft', async (request, reply) => {
    const body = z
      .object({
        fanId: z.string().min(1).optional(),
        opportunityId: z.string().min(1).optional(),
        topic: z.string().max(100).optional(),
      })
      .safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues })
    }
    const { fanId, opportunityId, topic } = body.data
    if (!fanId && !opportunityId) {
      return reply.code(400).send({ error: 'invalid_body', issues: [{ message: 'fanId or opportunityId required' }] })
    }

    const userId = currentUser(request)
    const fans = store.listFans(0, userId)
    let fan = fanId ? fans.find((f) => f.authorId === fanId) : undefined

    let opportunity = opportunityId ? store.getOpportunity(opportunityId, userId) : undefined
    if (opportunityId && !opportunity) {
      return reply.code(404).send({ error: 'not_found' })
    }
    // An opportunity-scoped draft targets its most engaged asker.
    if (!fan && opportunity) {
      const topAuthorId = opportunity.relatedAuthorIds[0]
      fan = topAuthorId ? fans.find((f) => f.authorId === topAuthorId) : undefined
      if (!fan && topAuthorId) {
        // The asker may not be a superfan yet — build a minimal fan from the
        // raw signals so we can still name them in the draft.
        const signal = store.listSignals(undefined, userId).find((s) => s.authorId === topAuthorId)
        if (signal) {
          fan = {
            authorId: signal.authorId,
            name: signal.authorName,
            engagementCount: 1,
            questionCount: 1,
            topics: [signal.topic],
            superfanScore: 0,
            lastActiveAt: signal.ingestedAt,
          }
        }
      }
    }
    if (!fan) {
      return reply.code(404).send({ error: 'not_found' })
    }

    const effectiveTopic = topic ?? (opportunity?.topicLabel ?? undefined)
    const draft = draftReply(fan, effectiveTopic)
    store.insertCreatorMemory({
      id: randomUUID(),
      kind: 'draft',
      content: draft,
      refId: opportunity ? opportunity.id : fan.authorId,
      createdAt: new Date().toISOString(),
    }, userId)
    return {
      ok: true,
      draft,
      fan: { authorId: fan.authorId, name: fan.name },
      opportunity: opportunity
        ? { id: opportunity.id, topicLabel: opportunity.topicLabel }
        : null,
    }
  })

  server.post('/api/pipeline/run', async (request) => {
    const body = pipelineBodySchema.safeParse(request.body)
    const stages: Stage[] = body.success ? body.data.stages : ['ingest', 'distill', 'relay']
    const summary = await runPipeline(pipelineDeps, stages, currentUser(request))
    return { ok: true, summary }
  })

  return server
}
