import { z } from 'zod'

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

export const SIGNAL_KINDS = ['question', 'request', 'topic', 'praise', 'critique'] as const
export type SignalKind = (typeof SIGNAL_KINDS)[number]

export const PLATFORMS = ['youtube', 'tiktok', 'x'] as const
export type Platform = (typeof PLATFORMS)[number]

export const SENTIMENTS = ['positive', 'negative', 'neutral'] as const
export type Sentiment = (typeof SENTIMENTS)[number]

export const OPPORTUNITY_STATUSES = ['open', 'proposed', 'approved', 'rejected', 'covered'] as const
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number]

export const DECISION_VALUES = ['approved', 'rejected'] as const
export type DecisionValue = (typeof DECISION_VALUES)[number]

export const DIGEST_ITEM_TYPES = ['opportunity', 'fan', 'alert'] as const
export type DigestItemType = (typeof DIGEST_ITEM_TYPES)[number]

export const CREATOR_MEMORY_KINDS = ['decision', 'covered', 'note', 'goal', 'preference', 'draft', 'brief'] as const
export type CreatorMemoryKind = (typeof CREATOR_MEMORY_KINDS)[number]

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export const commentSchema = z.object({
  id: z.string(),
  platform: z.enum(PLATFORMS),
  videoId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  text: z.string(),
  publishedAt: z.string(),
  ingestedAt: z.string(),
})
export type Comment = z.infer<typeof commentSchema>

export const signalSchema = z.object({
  id: z.string(),
  commentId: z.string(),
  platform: z.enum(PLATFORMS),
  videoId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  kind: z.enum(SIGNAL_KINDS),
  topic: z.string(),
  topicLabel: z.string(),
  text: z.string(),
  sentiment: z.enum(SENTIMENTS),
  ingestedAt: z.string(),
})
export type Signal = z.infer<typeof signalSchema>

export const fanSchema = z.object({
  authorId: z.string(),
  name: z.string(),
  engagementCount: z.number(),
  questionCount: z.number(),
  topics: z.array(z.string()),
  superfanScore: z.number().min(0).max(100),
  lastActiveAt: z.string(),
})
export type Fan = z.infer<typeof fanSchema>

export const opportunitySchema = z.object({
  id: z.string(),
  topic: z.string(),
  topicLabel: z.string(),
  demandScore: z.number(),
  repeatCount: z.number(),
  videoCount: z.number(),
  unanswered: z.boolean(),
  status: z.enum(OPPORTUNITY_STATUSES),
  relatedAuthorIds: z.array(z.string()),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
})
export type Opportunity = z.infer<typeof opportunitySchema>

export const decisionSchema = z.object({
  id: z.string(),
  opportunityId: z.string(),
  decision: z.enum(DECISION_VALUES),
  note: z.string(),
  createdAt: z.string(),
})
export type Decision = z.infer<typeof decisionSchema>

export const creatorMemoryEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(CREATOR_MEMORY_KINDS),
  content: z.string(),
  refId: z.string().nullable(),
  createdAt: z.string(),
})
export type CreatorMemoryEntry = z.infer<typeof creatorMemoryEntrySchema>

export const digestItemSchema = z.object({
  type: z.enum(DIGEST_ITEM_TYPES),
  refId: z.string(),
  title: z.string(),
  body: z.string(),
  score: z.number(),
})
export type DigestItem = z.infer<typeof digestItemSchema>

export const digestSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  items: z.array(digestItemSchema),
})
export type Digest = z.infer<typeof digestSchema>

// ---------------------------------------------------------------------------
// Mind protocol envelopes
//
// ToMind: what our backend feeds into the Mind (its memory + skills).
// FromMind: what the Mind produces back (opportunities, digests, drafts).
// ---------------------------------------------------------------------------

export const toMindMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('signals.batch'),
    id: z.string(),
    sentAt: z.string(),
    payload: z.object({
      signals: z.array(signalSchema),
      totalSignals: z.number(),
    }),
  }),
  z.object({
    type: z.literal('decision'),
    id: z.string(),
    sentAt: z.string(),
    payload: z.object({
      opportunityId: z.string(),
      topic: z.string(),
      decision: z.enum(DECISION_VALUES),
      note: z.string(),
    }),
  }),
  z.object({
    type: z.literal('creator.note'),
    id: z.string(),
    sentAt: z.string(),
    payload: z.object({
      content: z.string(),
    }),
  }),
  z.object({
    type: z.literal('digest.request'),
    id: z.string(),
    sentAt: z.string(),
    payload: z.object({}),
  }),
])
export type ToMindMessage = z.infer<typeof toMindMessageSchema>

export const fromMindMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('opportunity.created'),
    id: z.string(),
    receivedAt: z.string(),
    payload: z.object({ opportunity: opportunitySchema }),
  }),
  z.object({
    type: z.literal('opportunity.updated'),
    id: z.string(),
    receivedAt: z.string(),
    payload: z.object({ opportunity: opportunitySchema }),
  }),
  z.object({
    type: z.literal('digest'),
    id: z.string(),
    receivedAt: z.string(),
    payload: z.object({ digest: digestSchema }),
  }),
  z.object({
    type: z.literal('reply.draft'),
    id: z.string(),
    receivedAt: z.string(),
    payload: z.object({
      fanId: z.string(),
      topic: z.string(),
      draft: z.string(),
    }),
  }),
  z.object({
    type: z.literal('log'),
    id: z.string(),
    receivedAt: z.string(),
    payload: z.object({
      level: z.enum(['info', 'warn', 'error']),
      message: z.string(),
    }),
  }),
])
export type FromMindMessage = z.infer<typeof fromMindMessageSchema>
