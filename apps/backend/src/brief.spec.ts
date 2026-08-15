import { describe, expect, it } from 'vitest'
import { Store } from './db.js'
import { composeContentBrief } from './brief.js'
import { seedDatabase } from './seed.js'
import { runPipeline, type PipelineDeps } from './pipeline.js'
import { SimulatedMindGateway } from '@creatorsignal/mind-client'
import { distillComments } from './distill/distiller.js'

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

describe('composeContentBrief', () => {
  it('produces a brief with evidence from open opportunities', async () => {
    const store = new Store(':memory:')
    seedDatabase(store)
    await runPipeline(makeDeps(store), ['distill', 'relay'])

    const brief = composeContentBrief(store)
    expect(brief.items.length).toBeGreaterThan(0)
    expect(brief.items.length).toBeLessThanOrEqual(3)
    expect(brief.headline.length).toBeGreaterThan(0)
    expect(brief.period).toMatch(/^\w+ \d+ – \w+ \d+$/)
    for (const item of brief.items) {
      expect(item.demandScore).toBeGreaterThanOrEqual(0)
      expect(item.repeatCount).toBeGreaterThan(0)
      expect(item.angle.length).toBeGreaterThan(10)
    }
    // Sorted by demand, highest first.
    const scores = brief.items.map((i) => i.demandScore)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  it('excludes covered topics once the creator approves an opportunity', async () => {
    const store = new Store(':memory:')
    seedDatabase(store)
    await runPipeline(makeDeps(store), ['distill', 'relay'])

    const before = composeContentBrief(store)
    const top = before.items[0]
    if (!top) throw new Error('expected at least one brief item')

    // Simulate approval: record a decision on the matching opportunity.
    const opp = store
      .listOpportunities()
      .find((o) => o.topic === top.topic)
    if (!opp) throw new Error('expected matching opportunity')
    store.updateOpportunityStatus(opp.id, 'approved')
    store.insertDecision({
      id: 'd-test',
      opportunityId: opp.id,
      decision: 'approved',
      note: 'covered',
      createdAt: new Date().toISOString(),
    })

    const after = composeContentBrief(store)
    expect(after.items.find((i) => i.topic === top.topic)).toBeUndefined()
  })

  it('returns an empty brief when everything is covered', async () => {
    const store = new Store(':memory:')
    seedDatabase(store)
    await runPipeline(makeDeps(store), ['distill', 'relay'])

    for (const opp of store.listOpportunities()) {
      store.updateOpportunityStatus(opp.id, 'approved')
      store.insertDecision({
        id: `d-${opp.id}`,
        opportunityId: opp.id,
        decision: 'approved',
        note: 'covered',
        createdAt: new Date().toISOString(),
      })
    }
    const brief = composeContentBrief(store)
    expect(brief.items).toEqual([])
  })
})
