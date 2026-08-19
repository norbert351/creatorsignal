import { randomUUID } from 'node:crypto'
import type { Comment, Digest, Signal } from '@creatorsignal/shared'
import type { MindGateway } from '@creatorsignal/mind-client'
import type { Store } from './db.js'
import type { TelegramNotifier } from './telegram-notify.js'
import type { WebhookNotifier } from './webhook-notify.js'

export type Stage = 'ingest' | 'distill' | 'relay'

export interface PipelineDeps {
  /** Pulls new comments from the source for a user's workspace. Returns what was newly stored. */
  ingest: (userId?: string) => Promise<Comment[]>
  /** Turns raw comments into signals. */
  distill: (comments: Comment[]) => Promise<Signal[]>
  gateway: MindGateway
  store: Store
  minDemandScore: number
  superfanThreshold: number
  /** Optional push channel: notifies the creator's Telegram group. */
  notify?: TelegramNotifier
  /** Optional alternate channel: POSTs new opportunities to a webhook. */
  webhookNotify?: WebhookNotifier
}

export interface PipelineSummary {
  stages: Stage[]
  ingested: number
  distilled: number
  opportunitiesCreated: number
  opportunitiesUpdated: number
  fans: number
  digestItems: number
  relayed: number
}

/**
 * The main loop: Listen -> Remember -> Understand -> Detect -> Recommend.
 * Stage by stage so the demo can replay any part of the pipeline.
 */
export async function runPipeline(
  deps: PipelineDeps,
  stages: Stage[],
  userId = 'local',
): Promise<PipelineSummary> {
  const summary: PipelineSummary = {
    stages,
    ingested: 0,
    distilled: 0,
    opportunitiesCreated: 0,
    opportunitiesUpdated: 0,
    fans: 0,
    digestItems: 0,
    relayed: 0,
  }
  const { store, gateway } = deps

  if (stages.includes('ingest')) {
    const comments = await deps.ingest(userId)
    summary.ingested = comments.length
  }

  if (stages.includes('distill')) {
    const pending = store.listUnsignaledComments(1000, userId)
    if (pending.length > 0) {
      const signals = await deps.distill(pending)
      summary.distilled = store.insertSignals(signals, userId)
    }
  }

  if (stages.includes('relay')) {
    const signals = store.listSignals(undefined, userId)
    const ctx = {
      opportunities: store.listOpportunities(undefined, userId),
      fans: store.listFans(0, userId),
      coveredTopics: store.coveredTopics(userId),
      minDemandScore: deps.minDemandScore,
      superfanThreshold: deps.superfanThreshold,
    }
    const result = await gateway.processSignals(signals, ctx)
    summary.relayed = signals.length
    const created = result.opportunities.filter(
      (o) => ctx.opportunities.findIndex((p) => p.topic === o.topic) === -1,
    )
    summary.opportunitiesCreated = created.length
    for (const opportunity of result.opportunities) store.upsertOpportunity(opportunity, userId)
    summary.opportunitiesUpdated = result.opportunities.length - summary.opportunitiesCreated
    for (const fan of result.fans) store.upsertFan(fan, userId)
    summary.fans = result.fans.length
    if (result.digestItems.length > 0) {
      const digest: Digest = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        items: result.digestItems,
      }
      store.insertDigest(digest, userId)
      summary.digestItems = result.digestItems.length
    }
    // Push new opportunity cards to the creator's Telegram group + webhook
    // (if configured). Fire-and-forget: a slow call must never block the
    // pipeline.
    for (const opportunity of created) {
      void deps.notify?.opportunityCreated(opportunity)
      void deps.webhookNotify?.opportunityCreated(opportunity)
    }
  }

  return summary
}
