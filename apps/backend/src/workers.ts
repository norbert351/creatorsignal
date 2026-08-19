import { randomUUID } from 'node:crypto'
import type { Digest } from '@creatorsignal/shared'
import type { MindGateway } from '@creatorsignal/mind-client'
import { composeContentBrief } from './brief.js'
import type { Store } from './db.js'
import type { PipelineDeps, PipelineSummary } from './pipeline.js'
import { runPipeline } from './pipeline.js'
import type { TelegramNotifier } from './telegram-notify.js'
import type { WebhookNotifier } from './webhook-notify.js'

export interface WorkerOptions {
  store: Store
  gateway: MindGateway
  pipelineDeps: PipelineDeps
  ingestIntervalMin: number
  /** Daily digest time, HH:MM local server time. */
  digestTime: string
  /** Weekly brief: day of week (0=Sunday..6=Saturday) + HH:MM local time. */
  briefDay?: number
  briefTime?: string
  /** Optional push channel: notifies the creator's Telegram group. */
  notify?: TelegramNotifier
  /** Optional alternate channel: POSTs digest/brief to a configured webhook. */
  webhookNotify?: WebhookNotifier
  log?: (message: string) => void
}

export interface WorkerHandle {
  stop: () => void
}

function msUntilNext(target: string): number {
  const [hour, minute] = target.split(':').map(Number)
  const now = new Date()
  const next = new Date(now)
  next.setHours(hour ?? 9, minute ?? 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

function msUntilWeekly(targetDay: number, target: string): number {
  const [hour, minute] = target.split(':').map(Number)
  const now = new Date()
  const next = new Date(now)
  next.setHours(hour ?? 9, minute ?? 0, 0, 0)
  let daysAhead = (targetDay - next.getDay() + 7) % 7
  if (daysAhead === 0 && next.getTime() <= now.getTime()) daysAhead = 7
  next.setDate(next.getDate() + daysAhead)
  return next.getTime() - now.getTime()
}

/**
 * Autonomy layer: on a schedule the backend feeds the Mind and asks for its
 * digest, so the creator gets pushed results instead of having to ask.
 */
export function startWorkers(options: WorkerOptions): WorkerHandle {
  const {
    store,
    gateway,
    pipelineDeps,
    ingestIntervalMin,
    digestTime,
    briefDay,
    briefTime,
    notify,
    webhookNotify,
  } = options
  const log = options.log ?? ((message: string) => console.log(`[workers] ${message}`))
  let running = false

  const guarded = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    if (running) {
      log(`skipping ${name}, previous run still active`)
      return
    }
    running = true
    try {
      await fn()
    } catch (error) {
      log(`${name} failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      running = false
    }
  }

  const ingestLoop = () =>
    guarded('pipeline', async () => {
      const summary = await runPipeline(pipelineDeps, ['ingest', 'distill', 'relay'])
      log(
        `pipeline: ingested=${summary.ingested} distilled=${summary.distilled} ` +
          `opportunities=${summary.opportunitiesCreated + summary.opportunitiesUpdated} fans=${summary.fans}`,
      )
    })

  const digestLoop = () =>
    guarded('digest', async () => {
      const ctx = {
        opportunities: store.listOpportunities(),
        fans: store.listFans(0),
        coveredTopics: store.coveredTopics(),
        minDemandScore: pipelineDeps.minDemandScore,
        superfanThreshold: pipelineDeps.superfanThreshold,
      }
      const items = await gateway.requestDigest(ctx)
      if (items.length === 0) {
        log('digest: no items')
        return
      }
      const digest: Digest = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        items,
      }
      store.insertDigest(digest)
      log(`digest: stored ${items.length} items`)
      void options.notify?.digest(digest)
      void options.webhookNotify?.digest(digest)
    })

  const briefLoop = () =>
    guarded('brief', async () => {
      const brief = composeContentBrief(store)
      store.insertCreatorMemory({
        id: `brief-${brief.id}`,
        kind: 'brief',
        content: JSON.stringify(brief),
        refId: brief.id,
        createdAt: brief.generatedAt,
      })
      log(
        `brief: ${brief.items.length} items — ${brief.items.map((i) => i.topicLabel).join(', ') || 'nothing open'}`,
      )
      void notify?.brief(brief)
      void webhookNotify?.brief(brief)
    })

  const ingestTimer = setInterval(ingestLoop, ingestIntervalMin * 60_000)
  let digestTimer: ReturnType<typeof setTimeout>
  let briefTimer: ReturnType<typeof setTimeout>
  const scheduleDigest = (): void => {
    digestTimer = setTimeout(() => {
      void digestLoop().then(scheduleDigest)
    }, msUntilNext(digestTime))
  }
  scheduleDigest()
  const scheduleBrief = (): void => {
    const waitMs = msUntilWeekly(briefDay ?? 1, briefTime ?? '09:00')
    briefTimer = setTimeout(() => {
      void briefLoop().then(scheduleBrief)
    }, waitMs)
    log(`brief scheduled in ${Math.round(waitMs / 86_400_000)}d`)
  }
  scheduleBrief()

  // Fire once shortly after boot so a fresh deploy shows results immediately.
  const bootTimer = setTimeout(() => void ingestLoop(), 2_000)

  return {
    stop: () => {
      clearInterval(ingestTimer)
      clearTimeout(bootTimer)
      clearTimeout(digestTimer)
      clearTimeout(briefTimer)
    },
  }
}

export type { PipelineSummary }
