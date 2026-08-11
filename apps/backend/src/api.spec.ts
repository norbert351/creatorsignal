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
    server = buildServer({ store, gateway: new SimulatedMindGateway(), pipelineDeps: makeDeps(store), config: makeConfig() })
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
})

describe('api auth', () => {
  let store: Store
  let server: FastifyInstance

  beforeAll(async () => {
    store = new Store(':memory:')
    seedDatabase(store)
    const config = makeConfig({ CREATORSIGNAL_API_TOKEN: 'test-secret-123' })
    server = buildServer({ store, gateway: new SimulatedMindGateway(), pipelineDeps: makeDeps(store), config })
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
