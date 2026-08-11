import { describe, it, expect } from 'vitest'
import {
  signalSchema,
  fromMindMessageSchema,
  toMindMessageSchema,
  opportunitySchema,
  type Signal,
  type Opportunity,
  type FromMindMessage,
} from './contracts.js'

const baseSignal: Signal = {
  id: 's1',
  commentId: 'c1',
  platform: 'youtube',
  videoId: 'v1',
  authorId: 'a1',
  authorName: 'GeoCurious_MK',
  kind: 'question',
  topic: 'bir claim egypt tawil',
  topicLabel: 'Bir Claim Egypt Tawil',
  text: 'why doesnt egypt claim bir tawil',
  sentiment: 'neutral',
  ingestedAt: '2026-08-01T00:00:00.000Z',
}

const baseOpportunity: Opportunity = {
  id: 'o1',
  topic: 'bir claim egypt tawil',
  topicLabel: 'Bir Claim Egypt Tawil',
  demandScore: 40,
  repeatCount: 47,
  videoCount: 6,
  unanswered: true,
  status: 'open',
  relatedAuthorIds: ['a1'],
  firstSeenAt: '2026-08-01T00:00:00.000Z',
  lastSeenAt: '2026-08-02T00:00:00.000Z',
}

describe('contracts', () => {
  it('parses a valid signal', () => {
    expect(signalSchema.parse(baseSignal)).toEqual(baseSignal)
  })

  it('rejects an unknown signal kind', () => {
    const bad = { ...baseSignal, kind: 'meme' }
    expect(signalSchema.safeParse(bad).success).toBe(false)
  })

  it('bounds superfan scores', () => {
    expect(opportunitySchema.parse(baseOpportunity).demandScore).toBe(40)
  })

  it('parses a from-mind opportunity.created envelope', () => {
    const msg: FromMindMessage = {
      type: 'opportunity.created',
      id: 'm1',
      receivedAt: '2026-08-02T00:00:00.000Z',
      payload: { opportunity: baseOpportunity },
    }
    expect(fromMindMessageSchema.parse(msg).type).toBe('opportunity.created')
  })

  it('rejects a from-mind envelope with unknown type', () => {
    const bad = { type: 'not.real', id: 'x', receivedAt: 'now', payload: {} }
    expect(fromMindMessageSchema.safeParse(bad).success).toBe(false)
  })

  it('parses a to-mind signals.batch envelope', () => {
    const msg = {
      type: 'signals.batch',
      id: 'm2',
      sentAt: '2026-08-02T00:00:00.000Z',
      payload: { signals: [baseSignal], totalSignals: 1 },
    }
    expect(toMindMessageSchema.parse(msg).type).toBe('signals.batch')
  })
})
