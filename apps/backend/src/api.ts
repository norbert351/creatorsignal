import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { z } from 'zod'
import { DECISION_VALUES } from '@creatorsignal/shared'
import { draftReply } from '@creatorsignal/mind-client'
import type { MindGateway } from '@creatorsignal/mind-client'
import type { Config } from './config.js'
import type { Store } from './db.js'
import type { PipelineDeps } from './pipeline.js'
import { runPipeline } from './pipeline.js'
import type { Stage } from './pipeline.js'
import { composeContentBrief } from './brief.js'
import type { TelegramNotifier } from './telegram-notify.js'

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

/** Single-creator workspace id for the jam demo (multi-tenant auth is post-jam). */
const DEFAULT_USER_ID = 'local'

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
}

export function buildServer(deps: ServerDeps) {
  const { store, gateway, pipelineDeps, config, notify } = deps
  const server = Fastify({ logger: { level: config.logLevel } })

  void server.register(cors, { origin: true })

  // Static viewer (pure client, no secrets). The dashboard lives at /viewer/,
  // the marketing landing at /.
  const viewerDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'viewer')
  void server.register(fastifyStatic, { root: viewerDir, prefix: '/viewer/' })
  server.get('/', async (_request, reply) => reply.sendFile('landing.html', viewerDir))

  if (config.apiToken) {
    server.addHook('onRequest', async (request, reply) => {
      const url = request.url
      if (url === '/health' || url.startsWith('/health')) return
      if (url === '/' || url.startsWith('/viewer/')) return
      if (request.headers.authorization !== `Bearer ${config.apiToken}`) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
    })
  }

  server.get('/health', async () => ({
    ok: true,
    mindMode: gateway.mode,
    stats: store.stats(),
  }))

  server.get('/api/signals', async (request) => {
    const query = z
      .object({
        kind: z.enum(['question', 'request', 'topic', 'praise', 'critique']).optional(),
        limit: z.coerce.number().int().positive().max(500).optional(),
      })
      .parse(request.query)
    let signals = store.listSignals(query.kind)
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
    let comments = store.listComments(query.videoId)
    if (query.limit !== undefined) comments = comments.slice(0, query.limit)
    const videos = videoMap(store)
    return { comments: comments.map((c) => withVideo(c, videos)) }
  })

  server.get('/api/opportunities', async (request) => {
    const query = z
      .object({ status: z.enum(['open', 'proposed', 'approved', 'rejected', 'covered']).optional() })
      .parse(request.query)
    const opportunities = store.listOpportunities(query.status)
    const fans = store.listFans(0)
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
    const opportunity = store.getOpportunity(params.id)
    if (!opportunity) {
      return reply.code(404).send({ error: 'not_found' })
    }
    const { decision, note } = body.data
    store.updateOpportunityStatus(opportunity.id, decision)
    store.insertDecision({
      id: randomUUID(),
      opportunityId: opportunity.id,
      decision,
      note,
      createdAt: new Date().toISOString(),
    })
    store.insertCreatorMemory({
      id: randomUUID(),
      kind: 'decision',
      content: `${opportunity.topicLabel} (${opportunity.topic}): ${decision}`,
      refId: opportunity.id,
      createdAt: new Date().toISOString(),
    })
    await gateway.recordDecision(opportunity, decision, note)
    return { ok: true, opportunity: store.getOpportunity(opportunity.id) }
  })

  server.get('/api/fans', async (request) => {
    const query = z
      .object({ minScore: z.coerce.number().int().min(0).max(100).optional() })
      .parse(request.query)
    return { fans: store.listFans(query.minScore ?? 0) }
  })

  // -------------------------------------------------------------------------
  // Creator onboarding: profile + connected targets
  // -------------------------------------------------------------------------

  server.get('/api/profile', async () => {
    const user = store.getUser(DEFAULT_USER_ID)
    return { user, targets: store.listTargets(DEFAULT_USER_ID) }
  })

  server.post('/api/profile', async (request, reply) => {
    const body = profileBodySchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues })
    }
    store.upsertUser({
      id: DEFAULT_USER_ID,
      name: body.data.name,
      handle: body.data.handle,
      createdAt: new Date().toISOString(),
    })
    store.insertCreatorMemory({
      id: randomUUID(),
      kind: 'preference',
      content: `creator profile: ${body.data.name} (${body.data.handle})`,
      refId: DEFAULT_USER_ID,
      createdAt: new Date().toISOString(),
    })
    return { user: store.getUser(DEFAULT_USER_ID), targets: store.listTargets(DEFAULT_USER_ID) }
  })

  server.post('/api/targets', async (request, reply) => {
    const body = targetBodySchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues })
    }
    const target = {
      id: randomUUID(),
      userId: DEFAULT_USER_ID,
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
    return { ok: true, target, targets: store.listTargets(DEFAULT_USER_ID) }
  })

  server.delete('/api/targets/:id', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const removed = store.removeTarget(params.id)
    if (!removed) {
      return reply.code(404).send({ error: 'not_found' })
    }
    return { ok: true, targets: store.listTargets(DEFAULT_USER_ID) }
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
  // Weekly content brief (autonomous "make this next" plan)
  // -------------------------------------------------------------------------

  server.get('/api/brief/latest', async () => {
    const entries = store.listCreatorMemory('brief')
    if (entries.length === 0) return { ok: true, brief: null }
    try {
      return { ok: true, brief: JSON.parse(entries[0]!.content) as unknown }
    } catch {
      return { ok: true, brief: null }
    }
  })

  server.post('/api/brief/generate', async () => {
    const brief = composeContentBrief(store)
    store.insertCreatorMemory({
      id: `brief-${brief.id}`,
      kind: 'brief',
      content: JSON.stringify(brief),
      refId: brief.id,
      createdAt: brief.generatedAt,
    })
    // Push to Telegram when connected (fire-and-forget).
    void notify.brief(brief)
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
    return { memory: store.listCreatorMemory(query.kind) }
  })

  server.get('/api/digests', async (request) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(50).optional() }).parse(request.query)
    return { digests: store.listDigests(query.limit ?? 20) }
  })

  server.post('/api/reply-draft', async (request, reply) => {
    const body = z
      .object({ fanId: z.string().min(1), topic: z.string().max(100).optional() })
      .safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues })
    }
    const fan = store.listFans(0).find((f) => f.authorId === body.data.fanId)
    if (!fan) {
      return reply.code(404).send({ error: 'not_found' })
    }
    const draft = draftReply(fan, body.data.topic)
    store.insertCreatorMemory({
      id: randomUUID(),
      kind: 'draft',
      content: draft,
      refId: fan.authorId,
      createdAt: new Date().toISOString(),
    })
    return { ok: true, draft, fan }
  })

  server.post('/api/pipeline/run', async (request) => {
    const body = pipelineBodySchema.safeParse(request.body)
    const stages: Stage[] = body.success ? body.data.stages : ['ingest', 'distill', 'relay']
    const summary = await runPipeline(pipelineDeps, stages)
    return { ok: true, summary }
  })

  return server
}
