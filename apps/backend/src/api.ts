import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { z } from 'zod'
import { DECISION_VALUES, normalizeTopic } from '@creatorsignal/shared'
import type { MindGateway } from '@creatorsignal/mind-client'
import type { Config } from './config.js'
import type { Store } from './db.js'
import type { PipelineDeps, PipelineSummary } from './pipeline.js'
import { runPipeline } from './pipeline.js'
import { buildDemoComments, seedDatabase } from './seed.js'
import type { Stage } from './pipeline.js'

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

export interface ServerDeps {
  store: Store
  gateway: MindGateway
  pipelineDeps: PipelineDeps
  config: Config
}

export function buildServer(deps: ServerDeps) {
  const { store, gateway, pipelineDeps, config } = deps
  const server = Fastify({ logger: { level: config.logLevel } })

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
    return { signals }
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

  server.get('/api/memory', async (request) => {
    const query = z
      .object({ kind: z.enum(['decision', 'covered', 'note', 'goal', 'preference', 'draft']).optional() })
      .parse(request.query)
    return { memory: store.listCreatorMemory(query.kind) }
  })

  server.get('/api/digests', async (request) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(50).optional() }).parse(request.query)
    return { digests: store.listDigests(query.limit ?? 20) }
  })

  server.post('/api/pipeline/run', async (request) => {
    const body = pipelineBodySchema.safeParse(request.body)
    const stages: Stage[] = body.success ? body.data.stages : ['ingest', 'distill', 'relay']
    const summary = await runPipeline(pipelineDeps, stages)
    return { ok: true, summary }
  })

  server.post('/api/seed/reset', async (request, reply) => {
    const count = seedDatabase(store)
    const summary: PipelineSummary = await runPipeline(pipelineDeps, ['distill', 'relay'])
    return { ok: true, seeded: count, summary }
  })

  // Convenience for demos: list what topics the fixture dataset contains.
  server.get('/api/seed/preview', async () => {
    const comments = buildDemoComments()
    const topics = new Map<string, number>()
    for (const comment of comments) {
      const key = normalizeTopic(comment.text)
      topics.set(key, (topics.get(key) ?? 0) + 1)
    }
    return {
      comments: comments.length,
      videos: [...new Set(comments.map((c) => c.videoId))].length,
      topTopics: [...topics.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([topic, count]) => ({ topic, count })),
    }
  })

  return server
}
