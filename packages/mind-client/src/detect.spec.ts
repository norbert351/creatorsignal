import { describe, it, expect } from 'vitest'
import type { Fan, Opportunity, Signal } from '@creatorsignal/shared'
import { computeFans, composeDigest, detectOpportunities, draftReply } from './detect.js'

function signal(overrides: Partial<Signal>): Signal {
  return {
    id: 's',
    commentId: 'c',
    videoId: 'v1',
    authorId: 'a1',
    authorName: 'Fan One',
    kind: 'question',
    topic: 'bir claim egypt tawil',
    topicLabel: 'Bir Claim Egypt Tawil',
    text: 'why doesnt egypt claim bir tawil',
    sentiment: 'neutral',
    ingestedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeCluster(count: number, topic: string, label: string): Signal[] {
  const out: Signal[] = []
  for (let i = 0; i < count; i++) {
    out.push(
      signal({
        id: `s-${topic}-${i}`,
        commentId: `c-${topic}-${i}`,
        videoId: `v${(i % 6) + 1}`,
        authorId: `a-${topic}-${i % 12}`,
        authorName: `Fan ${i % 12}`,
        topic,
        topicLabel: label,
        ingestedAt: new Date(Date.parse('2026-08-01T00:00:00.000Z') + i * 60_000).toISOString(),
      }),
    )
  }
  return out
}

const opts = { minDemandScore: 25, coveredTopics: new Set<string>() }

describe('detectOpportunities', () => {
  it('surfaces the repeated unanswered question as one opportunity', () => {
    const signals = makeCluster(47, 'bir claim egypt tawil', 'Bir Claim Egypt Tawil')
    const { created, updated } = detectOpportunities(signals, [], opts)
    expect(created).toHaveLength(1)
    expect(updated).toHaveLength(0)
    const opp = created[0]
    if (!opp) throw new Error('missing opportunity')
    expect(opp.repeatCount).toBe(47)
    expect(opp.videoCount).toBe(6)
    expect(opp.unanswered).toBe(true)
    expect(opp.demandScore).toBe(47 * 3 + 6 * 5 + 12)
  })

  it('keeps an already covered topic from becoming an opportunity', () => {
    const signals = makeCluster(30, 'bir claim egypt tawil', 'Bir Claim Egypt Tawil')
    const { created } = detectOpportunities(signals, [], {
      ...opts,
      coveredTopics: new Set(['bir claim egypt tawil']),
    })
    expect(created).toHaveLength(0)
  })

  it('does not create opportunities below the demand threshold', () => {
    const twoAsksOneVideo = makeCluster(2, 'random question', 'Random Question').map((s) => ({
      ...s,
      videoId: 'v1',
    }))
    const { created } = detectOpportunities(twoAsksOneVideo, [], opts)
    expect(created).toHaveLength(0)
  })

  it('updates existing opportunities with fresh scores', () => {
    const signals = makeCluster(50, 'bir claim egypt tawil', 'Bir Claim Egypt Tawil')
    const previous: Opportunity = {
      id: 'o1',
      topic: 'bir claim egypt tawil',
      topicLabel: 'Bir Claim Egypt Tawil',
      demandScore: 100,
      repeatCount: 10,
      videoCount: 2,
      unanswered: true,
      status: 'open',
      relatedAuthorIds: [],
      firstSeenAt: '2026-07-01T00:00:00.000Z',
      lastSeenAt: '2026-07-01T00:00:00.000Z',
    }
    const { created, updated } = detectOpportunities(signals, [previous], opts)
    expect(created).toHaveLength(0)
    const updatedOpp = updated[0]
    if (!updatedOpp) throw new Error('missing update')
    expect(updatedOpp.repeatCount).toBe(50)
    expect(updatedOpp.id).toBe('o1')
    expect(updatedOpp.status).toBe('open')
  })

  it('keeps rejected status on resurface', () => {
    const signals = makeCluster(50, 'bir claim egypt tawil', 'Bir Claim Egypt Tawil')
    const rejected: Opportunity = {
      id: 'o2',
      topic: 'bir claim egypt tawil',
      topicLabel: 'Bir Claim Egypt Tawil',
      demandScore: 90,
      repeatCount: 30,
      videoCount: 5,
      unanswered: true,
      status: 'rejected',
      relatedAuthorIds: [],
      firstSeenAt: '2026-07-01T00:00:00.000Z',
      lastSeenAt: '2026-07-05T00:00:00.000Z',
    }
    const { updated } = detectOpportunities(signals, [rejected], opts)
    expect(updated[0]?.status).toBe('rejected')
  })
})

describe('computeFans', () => {
  it('ranks the most engaged authors as superfans', () => {
    const clusterAuthor = 'a-bir claim egypt tawil-0'
    const signals: Signal[] = [
      ...makeCluster(6, 'bir claim egypt tawil', 'Bir Claim Egypt Tawil'),
      signal({ id: 'x1', commentId: 'cx1', authorId: clusterAuthor, authorName: 'Fan 0', kind: 'praise', topic: 'egypt', topicLabel: 'Egypt', sentiment: 'positive' }),
    ]
    const fans = computeFans(signals, { superfanThreshold: 18 })
    expect(fans.length).toBeGreaterThan(0)
    const top = fans.sort((a, b) => b.superfanScore - a.superfanScore)[0]
    if (!top) throw new Error('no fans')
    expect(top.engagementCount).toBeGreaterThanOrEqual(2)
    expect(top.superfanScore).toBeLessThanOrEqual(100)
  })

  it('caps scores at 100', () => {
    const bulk: Signal[] = Array.from({ length: 10 }, (_, i) =>
      signal({
        id: `bulk-${i}`,
        commentId: `bulk-c-${i}`,
        authorId: 'bulk-fan',
        authorName: 'Bulk Fan',
        topic: 'bir claim egypt tawil',
      }),
    )
    const fans = computeFans(bulk, { superfanThreshold: 0 })
    const fan = fans[0]
    if (!fan) throw new Error('no fan')
    expect(fan.superfanScore).toBe(100)
  })
})

describe('draftReply', () => {
  const fan: Fan = {
    authorId: 'a1',
    name: 'GeoCurious_MK',
    engagementCount: 6,
    questionCount: 4,
    topics: ['bir claim egypt tawil', 'halaib triangle'],
    superfanScore: 100,
    lastActiveAt: '2026-08-02T00:00:00.000Z',
  }

  it('references the fans specific question count', () => {
    const draft = draftReply(fan)
    expect(draft).toContain('GeoCurious_MK')
    expect(draft).toContain('bir claim egypt tawil')
    expect(draft).toContain('4 times')
  })

  it('honors an explicit topic', () => {
    expect(draftReply(fan, 'minoan')).toContain('minoan')
  })

  it('falls back to engagement for non-question fans', () => {
    const quietFan: Fan = { ...fan, questionCount: 0, engagementCount: 3 }
    const draft = draftReply(quietFan)
    expect(draft).toContain('3 engagements')
  })
})

describe('composeDigest', () => {
  const opps: Opportunity[] = [
    {
      id: 'o1',
      topic: 'bir claim egypt tawil',
      topicLabel: 'Bir Claim Egypt Tawil',
      demandScore: 165,
      repeatCount: 47,
      videoCount: 6,
      unanswered: true,
      status: 'open',
      relatedAuthorIds: ['a1'],
      firstSeenAt: '2026-08-01T00:00:00.000Z',
      lastSeenAt: '2026-08-02T00:00:00.000Z',
    },
    {
      id: 'o2',
      topic: 'minoan',
      topicLabel: 'Minoan',
      demandScore: 30,
      repeatCount: 6,
      videoCount: 2,
      unanswered: true,
      status: 'open',
      relatedAuthorIds: ['a2'],
      firstSeenAt: '2026-08-01T00:00:00.000Z',
      lastSeenAt: '2026-08-02T00:00:00.000Z',
    },
  ]
  const fans: Fan[] = [
    {
      authorId: 'a1',
      name: 'GeoCurious_MK',
      engagementCount: 8,
      questionCount: 4,
      topics: ['bir claim egypt tawil'],
      superfanScore: 96,
      lastActiveAt: '2026-08-02T00:00:00.000Z',
    },
  ]

  it('alerts on newly created opportunities', () => {
    const items = composeDigest(opps, fans, { newlyCreatedIds: ['o1'], maxItems: 5 })
    expect(items.some((i) => i.type === 'alert' && i.refId === 'o1')).toBe(true)
    expect(items.some((i) => i.type === 'opportunity' && i.refId === 'o1')).toBe(true)
    expect(items.some((i) => i.type === 'fan' && i.refId === 'a1')).toBe(true)
  })

  it('orders opportunities by demand score', () => {
    const items = composeDigest(opps, fans, { newlyCreatedIds: [], maxItems: 5 }).filter((i) => i.type === 'opportunity')
    expect(items.map((i) => i.refId)).toEqual(['o1', 'o2'])
  })
})
