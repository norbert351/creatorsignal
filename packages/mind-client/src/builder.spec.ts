import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { MindsClient, MessagingEvent } from '@animocabrands/minds-client-lib'
import { MindsBuilderGateway } from './builder.js'

const mockClient = {
  ensureConversation: vi.fn(async () => ({ conversationId: 'conv-1', alias: 'creatorsignal' })),
  sendMessage: vi.fn(async () => ({})),
  getHistory: vi.fn(async () => [] as MessagingEvent[]),
  eventsIterator: vi.fn(),
}

vi.mock('@animocabrands/minds-client-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@animocabrands/minds-client-lib')>()
  return {
    ...actual,
    createMindsClient: () => mockClient as unknown as MindsClient,
    MindsApiError: actual.MindsApiError,
  }
})

const okMindId = 'mind-creatorsignal-001'
const okAlias = 'cs-test'

function makeGateway(onMessage?: (m: unknown) => Promise<void> | void) {
  const gateway = new MindsBuilderGateway({
    mindId: okMindId,
    alias: okAlias,
    pollIntervalMs: 10,
    onMessage,
    log: () => {},
  })
  return gateway
}

const anOpportunity = {
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
} as const

describe('MindsBuilderGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient.ensureConversation.mockResolvedValue({ conversationId: 'conv-1', alias: okAlias })
    mockClient.sendMessage.mockResolvedValue({})
    mockClient.getHistory.mockResolvedValue([])
  })

  it('sends a schema-valid signals.batch envelope as JSON message text', async () => {
    const gateway = makeGateway()
    const signal = {
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
    } as const

    const result = await gateway.processSignals([signal], {
      opportunities: [],
      fans: [],
      coveredTopics: new Set(),
      minDemandScore: 25,
      superfanThreshold: 30,
    })

    // ensureConversation resolves a durable alias on the right Mind.
    expect(mockClient.ensureConversation).toHaveBeenCalledWith(okAlias, okMindId)
    // sendMessage posts the envelope; messageText must parse to a valid ToMindMessage.
    const [body] = mockClient.sendMessage.mock.calls[0] as [{ alias: string; messageText: string }]
    expect(body.alias).toBe(okAlias)
    const envelope = JSON.parse(body.messageText)
    expect(envelope.type).toBe('signals.batch')
    expect(envelope.payload).toMatchObject({ totalSignals: 1 })
    // Valid shared-record shape inside the envelope -> gateway returns valid records.
    expect(envelope.payload.signals[0]).toMatchObject(signal)
    // Async flow: no immediate results; replies come via onMessage.
    expect(result).toEqual({ opportunities: [], fans: [], digestItems: [] })
  })

  it('records a decision envelope', async () => {
    const gateway = makeGateway()
    await gateway.recordDecision(anOpportunity, 'approved', 'cover the Bir Tawil claim')
    expect(mockClient.sendMessage).toHaveBeenCalledTimes(1)
    const [body] = mockClient.sendMessage.mock.calls[0] as [{ messageText: string }]
    const envelope = JSON.parse(body.messageText)
    expect(envelope.type).toBe('decision')
    expect(envelope.payload).toMatchObject({
      opportunityId: 'o1',
      decision: 'approved',
      topic: 'bir claim egypt tawil',
    })
  })

  it('parses a valid FromMindMessage reply into onMessage', async () => {
    const onMessage = vi.fn(async () => {})
    const gateway = makeGateway(onMessage)

    const reply: MessagingEvent = {
      fingerprint: 'fp-1',
      alias: okAlias,
      messageText: JSON.stringify({
        type: 'opportunity.created',
        id: 'm1',
        receivedAt: '2026-08-02T00:00:00.000Z',
        payload: { opportunity: anOpportunity },
      }),
    }
    mockClient.eventsIterator.mockReturnValue((async function* () {
      yield reply
    })())

    await gateway.start()
    // start warms history (empty) then pump fires -> onMessage gets the reply.
    await new Promise((resolve) => setTimeout(resolve, 60))
    await gateway.stop()

    expect(onMessage).toHaveBeenCalledTimes(1)
    const dispatched = onMessage.mock.calls[0][0] as { type: string; payload: { opportunity: unknown } }
    expect(dispatched.type).toBe('opportunity.created')
    // The dispatched record is a valid Opportunity shape.
    expect(dispatched.payload.opportunity).toMatchObject({ demandScore: 165, status: 'open' })
  })

  it('deduplicates replies by fingerprint across restarts', async () => {
    const onMessage = vi.fn(async () => {})
    mockClient.getHistory.mockResolvedValue([
      {
        fingerprint: 'fp-old',
        alias: okAlias,
        messageText: JSON.stringify({
          type: 'log',
          id: 'old',
          receivedAt: '2026-08-01T00:00:00.000Z',
          payload: { level: 'info', message: 'already seen' },
        }),
      },
    ])
    const gateway = makeGateway(onMessage)
    mockClient.eventsIterator.mockReturnValue((async function* () {
      yield {
        fingerprint: 'fp-old',
        alias: okAlias,
        messageText: JSON.stringify({
          type: 'log',
          id: 'old',
          receivedAt: '2026-08-01T00:00:00.000Z',
          payload: { level: 'info', message: 'already seen' },
        }),
      }
    })())

    await gateway.start()
    await new Promise((resolve) => setTimeout(resolve, 60))
    await gateway.stop()

    // History-warmed fingerprint is identical to the live event -> skipped.
    expect(onMessage).not.toHaveBeenCalled()
  })
})