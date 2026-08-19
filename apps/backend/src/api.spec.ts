import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
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
import { WebhookNotifier } from './webhook-notify.js'

function makeConfig(overrides: Record<string, string> = {}): Config {
  // Existing route tests exercise the open single-workspace mode; account
  // auth (CREATORSIGNAL_AUTH=on) is covered by its own describe block.
  return loadConfig({ CREATORSIGNAL_AUTH: 'off', ...overrides })
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

  it('enriches comments and signals with the source video', async () => {
    store.upsertVideo({
      videoId: 'v1',
      platform: 'youtube',
      title: 'Why Bir Tawil Exists',
      url: 'https://www.youtube.com/watch?v=v1',
    })
    const comments = await server.inject({ method: 'GET', url: '/api/comments?limit=200' })
    const commentBody = comments.json() as { comments: Array<{ videoId: string; videoTitle?: string; videoUrl?: string }> }
    const withVideo = commentBody.comments.find((c) => c.videoId === 'v1')
    expect(withVideo).toBeDefined()
    expect(withVideo?.videoTitle).toBe('Why Bir Tawil Exists')
    expect(withVideo?.videoUrl).toBe('https://www.youtube.com/watch?v=v1')

    const signals = await server.inject({ method: 'GET', url: '/api/signals' })
    const signalBody = signals.json() as { signals: Array<{ videoId: string; videoTitle?: string }> }
    const signal = signalBody.signals.find((s) => s.videoId === 'v1')
    expect(signal).toBeDefined()
    expect(signal?.videoTitle).toBe('Why Bir Tawil Exists')
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

describe('api drafts', () => {
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

  it('lists no drafts before any are generated', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/drafts' })
    expect(response.statusCode).toBe(200)
    expect(response.json().drafts).toEqual([])
  })

  it('drafts a reply scoped to an opportunity and lists it', async () => {
    const opp = store.listOpportunities()[0]
    if (!opp) throw new Error('no opportunity')
    const response = await server.inject({
      method: 'POST',
      url: '/api/reply-draft',
      payload: { opportunityId: opp.id },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.ok).toBe(true)
    expect(body.draft.length).toBeGreaterThan(0)
    expect(body.opportunity.topicLabel).toBe(opp.topicLabel)
    // Stored scoped to the opportunity.
    expect(store.listCreatorMemory('draft').some((m) => m.refId === opp.id)).toBe(true)

    const list = await server.inject({ method: 'GET', url: '/api/drafts' })
    const listed = list.json().drafts
    expect(listed.length).toBe(1)
    expect(listed[0].opportunity.topicLabel).toBe(opp.topicLabel)
  })

  it('400s a reply draft with neither fan nor opportunity', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/reply-draft',
      payload: {},
    })
    expect(response.statusCode).toBe(400)
  })

  it('404s a reply draft for an unknown opportunity', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/reply-draft',
      payload: { opportunityId: 'nope' },
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('api auth (viewer login gate)', () => {
  let store: Store
  let server: FastifyInstance

  beforeAll(async () => {
    store = new Store(':memory:')
    seedDatabase(store)
    const config = makeConfig({ CREATORSIGNAL_AUTH: 'on' })
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

  it('rejects api calls without a token', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/opportunities' })
    expect(response.statusCode).toBe(401)
  })

  it('rejects an invalid email at register', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'not-an-email', password: 'password123', name: 'A', handle: '@a' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('invalid_email')
  })

  it('registers an account and unlocks the api with its token', async () => {
    const register = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'creator@example.com', password: 'password123', name: 'Demo', handle: '@demo' },
    })
    expect(register.statusCode).toBe(200)
    const regBody = register.json()
    expect(regBody.token).toBeTruthy()
    expect(regBody.user.name).toBe('Demo')

    const denied = await server.inject({ method: 'GET', url: '/api/opportunities' })
    expect(denied.statusCode).toBe(401)

    const allowed = await server.inject({
      method: 'GET',
      url: '/api/opportunities',
      headers: { authorization: `Bearer ${regBody.token}` },
    })
    expect(allowed.statusCode).toBe(200)
  })

  it('rejects a duplicate email at register', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'creator@example.com', password: 'password123', name: 'Dup', handle: '@dup' },
    })
    expect(response.statusCode).toBe(409)
  })

  it('logs in with correct credentials and rejects bad ones', async () => {
    const bad = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'creator@example.com', password: 'wrongpass' },
    })
    expect(bad.statusCode).toBe(401)

    const good = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'creator@example.com', password: 'password123' },
    })
    expect(good.statusCode).toBe(200)
    expect(good.json().token).toBeTruthy()
  })

  it('reports the logged-in user via /api/auth/me', async () => {
    const login = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'creator@example.com', password: 'password123' },
    })
    const token = login.json().token
    const me = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().user.email).toBeUndefined()
    expect(me.json().user.name).toBe('Demo')
  })

  it('rotates the token on logout so the old one stops working', async () => {
    const login = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'creator@example.com', password: 'password123' },
    })
    const oldToken = login.json().token
    const logout = await server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${oldToken}` },
    })
    expect(logout.statusCode).toBe(200)
    const denied = await server.inject({
      method: 'GET',
      url: '/api/opportunities',
      headers: { authorization: `Bearer ${oldToken}` },
    })
    expect(denied.statusCode).toBe(401)
  })

  it('keeps auth routes and health public', async () => {
    const login = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'creator@example.com', password: 'password123' },
    })
    expect(login.statusCode).toBe(200)
    const health = await server.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
  })

  it('isolates profiles per account', async () => {
    // Account A sets a profile.
    const regA = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'alice@example.com', password: 'password123', name: 'Alice', handle: '@alice' },
    })
    const tokenA = regA.json().token
    const setA = await server.inject({
      method: 'POST',
      url: '/api/profile',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Alice Creator', handle: '@alice' },
    })
    expect(setA.statusCode).toBe(200)
    expect(store.listTargets(regA.json().user.id)).toHaveLength(0)

    // Account B sees its OWN empty profile, not Alice's.
    const regB = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'bob@example.com', password: 'password123', name: 'Bob', handle: '@bob' },
    })
    const tokenB = regB.json().token
    const profB = await server.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: `Bearer ${tokenB}` },
    })
    expect(profB.statusCode).toBe(200)
    // Bob sees HIS OWN register profile, not Alice's.
    expect(profB.json().user.name).toBe('Bob')
    expect(profB.json().user.name).not.toBe('Alice Creator')
    expect(profB.json().user.id).not.toBe(regA.json().user.id)

    // Alice's profile is unchanged.
    const profA = await server.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: `Bearer ${tokenA}` },
    })
    expect(profA.json().user.name).toBe('Alice Creator')
  })

  it('reports google login as disabled when no OAuth creds are configured', async () => {
    const health = await server.inject({ method: 'GET', url: '/health' })
    expect(health.json().google).toBe(false)
    const start = await server.inject({ method: 'GET', url: '/api/auth/google' })
    expect(start.statusCode).toBe(400)
    expect(start.json().error).toBe('google_not_configured')
  })
})

describe('api google auth (configured)', () => {
  let server: FastifyInstance
  let store: Store

  beforeAll(async () => {
    store = new Store(':memory:')
    const config = makeConfig({
      CREATORSIGNAL_AUTH: 'on',
      CREATORSIGNAL_GOOGLE_CLIENT_ID: 'tests.apps.googleusercontent.com',
      CREATORSIGNAL_GOOGLE_CLIENT_SECRET: 'g0sc-secret',
    })
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

  it('flags google available in health', async () => {
    const health = await server.inject({ method: 'GET', url: '/health' })
    expect(health.json().google).toBe(true)
  })

  it('redirects to Google authorize when starting the flow', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/google',
      headers: { host: 'localhost:9999' },
    })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toContain('accounts.google.com/o/oauth2/v2/auth')
    expect(response.headers.location).toContain(
      'redirect_uri=http%3A%2F%2Flocalhost%3A9999%2Fapi%2Fauth%2Fgoogle%2Fcallback',
    )
  })
})

describe('api webhook digest', () => {
  let store: Store
  let server: FastifyInstance
  let sink: Server
  let sinkUrl: string
  const received: Array<Record<string, unknown>> = []

  beforeAll(async () => {
    store = new Store(':memory:')
    seedDatabase(store)
    // Local HTTP sink to capture the webhook payloads.
    sink = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += String(chunk)))
      req.on('end', () => {
        received.push(JSON.parse(body) as Record<string, unknown>)
        res.writeHead(200)
        res.end()
      })
    })
    await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve))
    const address = sink.address() as { port: number }
    sinkUrl = `http://127.0.0.1:${address.port}/hook`
    server = buildServer({
      store,
      gateway: new SimulatedMindGateway(),
      pipelineDeps: makeDeps(store),
      config: makeConfig(),
      notify: new TelegramNotifier({ store }),
      webhookNotify: new WebhookNotifier({ store }),
    })
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
    store.close()
    await new Promise<void>((resolve) => sink.close(() => resolve()))
  })

  it('reports not enabled before any config', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/settings/webhook' })
    expect(response.statusCode).toBe(200)
    expect(response.json().enabled).toBe(false)
  })

  it('rejects an invalid url', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/settings/webhook',
      payload: { url: 'not-a-url' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('connects, fires a test ping, then disconnects', async () => {
    const connected = await server.inject({
      method: 'POST',
      url: '/api/settings/webhook',
      payload: { url: sinkUrl },
    })
    expect(connected.statusCode).toBe(200)
    expect(connected.json().enabled).toBe(true)
    // connect() sends a hello ping to the sink.
    expect(received.some((p) => p.kind === 'hello')).toBe(true)

    const disconnected = await server.inject({ method: 'DELETE', url: '/api/settings/webhook' })
    expect(disconnected.statusCode).toBe(200)
    expect(disconnected.json().enabled).toBe(false)
    const status = await server.inject({ method: 'GET', url: '/api/settings/webhook' })
    expect(status.json().enabled).toBe(false)
  })
})
