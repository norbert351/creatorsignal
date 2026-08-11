import { describe, it, expect } from 'vitest'
import { SimulatedMindGateway } from '@creatorsignal/mind-client'
import type { Comment } from '@creatorsignal/shared'
import { Store } from './db.js'
import { runPipeline, type PipelineDeps } from './pipeline.js'
import { buildDemoComments, seedDatabase } from './seed.js'

function makeDeps(store: Store, comments: Comment[]): PipelineDeps {
  const gateway = new SimulatedMindGateway()
  return {
    ingest: async () => {
      let inserted = 0
      for (const comment of comments) {
        if (store.insertComment(comment)) inserted++
      }
      return comments.slice(0, inserted)
    },
    distill: async (pending) => {
      return pending.map((c) => ({
        id: `sig-${c.id}`,
        commentId: c.id,
        videoId: c.videoId,
        authorId: c.authorId,
        authorName: c.authorName,
        kind: c.text.includes('?') || c.text.startsWith('why') ? ('question' as const) : ('topic' as const),
        topic: c.text.includes('bir tawil') ? 'bir claim egypt tawil' : `topic-${c.text.length}`,
        topicLabel: c.text.includes('bir tawil') ? 'Bir Claim Egypt Tawil' : 'Topic',
        text: c.text,
        sentiment: 'neutral' as const,
        ingestedAt: c.ingestedAt,
      }))
    },
    gateway,
    store,
    minDemandScore: 25,
    superfanThreshold: 30,
  }
}

describe('runPipeline end to end', () => {
  it('ingest -> distill -> relay surfaces the audience opportunity', async () => {
    const store = new Store(':memory:')
    const comments = buildDemoComments()
    const deps = makeDeps(store, comments)

    const summary = await runPipeline(deps, ['ingest', 'distill', 'relay'])
    expect(summary.ingested).toBe(comments.length)
    expect(summary.distilled).toBe(comments.length)
    expect(summary.relayed).toBe(comments.length)

    const opportunities = store.listOpportunities()
    const top = opportunities[0]
    if (!top) throw new Error('expected at least one opportunity')
    expect(top.topic).toBe('bir claim egypt tawil')
    expect(top.repeatCount).toBe(47)
    expect(top.videoCount).toBe(6)
    expect(top.unanswered).toBe(true)
    expect(top.status).toBe('open')
    expect(top.demandScore).toBe(47 * 3 + 6 * 5 + 12)

    const fans = store.listFans(0)
    expect(fans.length).toBeGreaterThan(10)
    const digests = store.listDigests()
    expect(digests.length).toBeGreaterThanOrEqual(1)
    expect(digests[0]?.items.some((i) => i.type === 'alert')).toBe(true)

    store.close()
  })

  it('idempotent: re-running the pipeline does not duplicate signals', async () => {
    const store = new Store(':memory:')
    const comments = buildDemoComments()
    const deps = makeDeps(store, comments)
    await runPipeline(deps, ['ingest', 'distill', 'relay'])
    const first = store.stats()
    await runPipeline(deps, ['ingest', 'distill', 'relay'])
    const second = store.stats()
    expect(second.signals).toBe(first.signals)
    expect(second.comments).toBe(first.comments)
    store.close()
  })

  it('a rejected opportunity stays rejected when the topic resurfaces', async () => {
    const store = new Store(':memory:')
    seedDatabase(store)
    const deps = makeDeps(store, buildDemoComments())
    await runPipeline(deps, ['distill', 'relay'])

    const top = store.listOpportunities()[0]
    if (!top) throw new Error('missing opportunity')
    store.updateOpportunityStatus(top.id, 'rejected')
    store.insertDecision({
      id: 'dec-1',
      opportunityId: top.id,
      decision: 'rejected',
      note: 'covered differently',
      createdAt: new Date().toISOString(),
    })
    store.insertCreatorMemory({
      id: 'mem-1',
      kind: 'decision',
      content: `${top.topicLabel}: rejected`,
      refId: top.id,
      createdAt: new Date().toISOString(),
    })

    await runPipeline(deps, ['relay'])
    const after = store.getOpportunity(top.id)
    expect(after?.status).toBe('rejected')
    store.close()
  })
})
