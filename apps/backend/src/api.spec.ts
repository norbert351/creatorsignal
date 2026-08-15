import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { SimulatedMindGateway } from '@creatorsignal/mind-client'
import type { Config } from './config.js'
import { loadConfig } from './config.js'
import { Store } from './db.js'
import { buildServer } from './api.js'
import { distillComments } from './distill/distiller.js'
import { runPipeline, type PipelineDeps } from './pipeline.js'
import { buildDemoComments, seedDatabase } from './seed.js'
import { TelegramNotifier } from './telegram-notify.js'

function makeConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig(overrides)
}

function makeDeps(store: Store): PipelineDeps {
  return {
    ingest: async () => [],
    distill: (comments) => distillComments(comments, null),
    gateway: new SimulatedMindGateway(),
    store,
    minDemandScore: 25,
    superfanThreshold: 30,
  }
}

describe('api server', () => {
  let server: FastifyInstance
  let store: Store

  beforeAll(async () => {
    store = new Store(':memory:')
    seedDatabase(store)
    await runPipeline(makeDeps(store), ['distill', 'relay'])
    server = buildServer({
      store,
      gateway: new SimulatedMindGateway(),
      pipelineDeps: makeDeps(store),
      config: makeConfig(),
      notify: new TelegramNotifier({ store }),
    })
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
    store.close()
  })

  it('health is open and reports state', async () => {
    const response = await server.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.ok).toBe(true)
    expect(body.stats.comments).toBe(103)
  })

  it('serves the marketing landing at / and the dashboard at /viewer/', async () => {
    const landing = await server.inject({ method: 'GET', url: '/' })
    expect(landing.statusCode).toBe(200)
    expect(landing.headers['content-type'] ?? '').toContain('text/html')
    expect(landing.body).toContain('Your audience is telling you')
    expect(landing.body).toContain('landing.css')

    const dashboard = await server.inject({ method: 'GET', url: '/viewer/' })
    expect(dashboard.statusCode).toBe(200)
    expect(dashboard.body).toContain('Connect your audience')
    expect(dashboard.body).toContain('style.css')
  })

  it('serves seeded comments', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/comments?limit=3' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.comments).toHaveLength(3)
  })

  it('serves opportunities with related authors', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/opportunities' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    const top = body.opportunities[0]
    expect(top.topic).toBe('bir claim egypt tawil')
    expect(top.repeatCount).toBe(48)
    expect(top.relatedAuthors.length).toBeGreaterThan(0)
  })

  it('sends CORS headers for browser viewers', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/opportunities',
      headers: { origin: 'http://localhost:5173' },
    })
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('drafts a reply for a real fan and stores it in memory', async () => {
    const fans = store.listFans(60)
    const fan = fans[0]
    if (!fan) throw new Error('no superfan')
    const response = await server.inject({
      method: 'POST',
      url: '/api/reply-draft',
      payload: { fanId: fan.authorId },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.draft).toContain(fan.name)
    expect(store.listCreatorMemory('draft').length).toBe(1)
  })

  it('404s a reply draft for an unknown fan', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/reply-draft',
      payload: { fanId: 'nobody' },
    })
    expect(response.statusCode).toBe(404)
  })

  it('returns no profile before onboarding', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/profile' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.user).toBeNull()
    expect(body.targets).toEqual([])
  })

  it('onboards a creator profile', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/profile',
      payload: { name: 'Demo Creator', handle: '@democreator' },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.user.name).toBe('Demo Creator')
    expect(body.user.handle).toBe('@democreator')
    expect(store.listCreatorMemory('preference').some((m) => m.content.includes('creator profile'))).toBe(true)
  })

  it('adds and removes a connected target', async () => {
    const add = await server.inject({
      method: 'POST',
      url: '/api/targets',
      payload: { platform: 'youtube', kind: 'channel', value: 'UC8gjFgWDbSGvGDgpzjfjfoQ' },
    })
    expect(add.statusCode).toBe(200)
    const added = add.json()
    expect(added.target.platform).toBe('youtube')
    expect(added.targets).toHaveLength(1)
    expect(store.listTargets('local')).toHaveLength(1)

    const del = await server.inject({ method: 'DELETE', url: `/api/targets/${added.target.id}` })
    expect(del.statusCode).toBe(200)
    expect(del.json().targets).toHaveLength(0)

    const missing = await server.inject({ method: 'DELETE', url: '/api/targets/nope' })
    expect(missing.statusCode).toBe(404)
  })

  it('rejects an invalid target payload', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/targets',
      payload: { platform: 'myspace', kind: 'channel', value: '' },
    })
    expect(response.statusCode).toBe(400)
  })
})

describe('api telegram settings', () => {
  let store: Store
  let server: FastifyInstance

  beforeAll(async () => {
    store = new Store(':memory:')
    seedDatabase(store)
    server = buildServer({
      store,
      gateway: new SimulatedMindGateway(),
      pipelineDeps: makeDeps(store),
      config: makeConfig(),
      notify: new TelegramNotifier({ store }),
    })
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
    store.close()
  })

  it('reports not enabled before any config', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/settings/telegram' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.ok).toBe(true)
    expect(body.enabled).toBe(false)
  })

  it('rejects a garbage bot token', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/settings/telegram',
      payload: { botToken: '123456:not-a-real-token', groupId: '@somegroup' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('validates the payload shape', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/settings/telegram',
      payload: { botToken: 'x' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('invalid_body')
  })
})

describe('api weekly brief', () => {
  let store: Store
  let server: FastifyInstance

  beforeAll(async () => {
    store = new Store(':memory:')
    seedDatabase(store)
    await runPipeline(makeDeps(store), ['distill', 'relay'])
    server = buildServer({
      store,
      gateway: new SimulatedMindGateway(),
      pipelineDeps: makeDeps(store),
      config: makeConfig(),
      notify: new TelegramNotifier({ store }),
    })
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
    store.close()
  })

  it('has no brief before generation', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/brief/latest' })
    expect(response.statusCode).toBe(200)
    expect(response.json().brief).toBeNull()
  })

  it('generates and returns a brief with evidence', async () => {
    const response = await server.inject({ method: 'POST', url: '/api/brief/generate' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.ok).toBe(true)
    expect(body.brief.items.length).toBeGreaterThan(0)
    expect(body.brief.headline.length).toBeGreaterThan(0)

    const latest = await server.inject({ method: 'GET', url: '/api/brief/latest' })
    const latestBody = latest.json()
    expect(latestBody.brief.items.length).toBe(body.brief.items.length)
  })
})

describe('api auth', () => {
  let store: Store
  let server: FastifyInstance

  beforeAll(async () => {
    store = new Store(':memory:')
    seedDatabase(store)
    const config = makeConfig({ CREATORSIGNAL_API_TOKEN: 'test-secret-123' })
    server = buildServer({
      store,
      gateway: new SimulatedMindGateway(),
      pipelineDeps: makeDeps(store),
      config,
      notify: new TelegramNotifier({ store }),
    })
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
    store.close()
  })

  it('rejects api calls without the token', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/opportunities' })
    expect(response.statusCode).toBe(401)
  })

  it('accepts the token', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/opportunities',
      headers: { authorization: 'Bearer test-secret-123' },
    })
    expect(response.statusCode).toBe(200)
  })

  it('keeps health public', async () => {
    const response = await server.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
  })
})
