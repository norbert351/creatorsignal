import type { Comment, FromMindMessage } from '@creatorsignal/shared'
import { SimulatedMindGateway, TelegramMindGateway } from '@creatorsignal/mind-client'
import type { MindGateway } from '@creatorsignal/mind-client'
import { buildServer } from './api.js'
import type { Config } from './config.js'
import { Store } from './db.js'
import { LlmClient } from './distill/llm.js'
import { distillComments } from './distill/distiller.js'
import { TiktokIngestor } from './ingest/tiktok.js'
import { XIngestor } from './ingest/x.js'
import { YoutubeIngestor } from './ingest/youtube.js'
import type { PipelineDeps } from './pipeline.js'
import { TelegramNotifier } from './telegram-notify.js'
import { WebhookNotifier } from './webhook-notify.js'
import { startWorkers } from './workers.js'

export interface App {
  store: Store
  gateway: MindGateway
  pipelineDeps: PipelineDeps
  notify: TelegramNotifier
  webhookNotify: WebhookNotifier
  start: () => Promise<void>
  stop: () => Promise<void>
}

function handleFromMind(store: Store): (message: FromMindMessage) => Promise<void> {
  return async (message) => {
    switch (message.type) {
      case 'opportunity.created':
      case 'opportunity.updated':
        store.upsertOpportunity(message.payload.opportunity)
        console.log(`[mind] opportunity ${message.type}: ${message.payload.opportunity.topicLabel}`)
        break
      case 'digest':
        store.insertDigest(message.payload.digest)
        console.log(`[mind] digest stored with ${message.payload.digest.items.length} items`)
        break
      case 'reply.draft':
        store.insertCreatorMemory({
          id: `draft-${message.id}`,
          kind: 'draft',
          content: message.payload.draft,
          refId: message.payload.fanId,
          createdAt: new Date().toISOString(),
        })
        console.log(`[mind] reply draft for fan ${message.payload.fanId}`)
        break
      case 'log':
        console.log(`[mind] ${message.payload.level}: ${message.payload.message}`)
        break
    }
  }
}

/**
 * Composition root. Builds the store, the gateway (simulated or real Mind),
 * the pipeline deps, the HTTP server, and the workers.
 */
export function createApp(config: Config, mindModeOverride?: 'simulated' | 'telegram'): App {
  const store = new Store(config.dbPath)
  const mode = mindModeOverride ?? config.mindMode

  let gateway: MindGateway
  if (mode === 'telegram') {
    gateway = new TelegramMindGateway({
      botToken: config.telegramBotToken ?? '',
      groupId: config.telegramGroupId ?? '',
      onMessage: handleFromMind(store),
      log: (level, message) => console.log(`[mind] ${level}: ${message}`),
    })
  } else {
    gateway = new SimulatedMindGateway()
  }

  const llm = config.llmApiKey
    ? new LlmClient({ apiKey: config.llmApiKey, baseUrl: config.llmBaseUrl, model: config.llmModel })
    : null
  const youtube = config.youtubeApiKey
    ? new YoutubeIngestor(
        config.youtubeApiKey,
        config.youtubeVideoIds,
        config.youtubeChannelId,
        config.ingestDaysBack,
      )
    : null
  const tiktok = config.tiktokApiKey
    ? new TiktokIngestor(config.tiktokApiKey, config.tiktokVideoIds, config.ingestDaysBack)
    : null
  const x = config.xBearerToken
    ? new XIngestor(config.xBearerToken, config.xUserIds, config.xQuery, config.ingestDaysBack)
    : null

  const pipelineDeps: PipelineDeps = {
    ingest: async (userId?: string) => {
      const results = await Promise.allSettled([
        youtube ? youtube.ingestNew(store, userId) : Promise.resolve([]),
        tiktok ? tiktok.ingestNew(store, userId) : Promise.resolve([]),
        x ? x.ingestNew(store, userId) : Promise.resolve([]),
      ])
      const comments: Comment[] = []
      for (const result of results) {
        if (result.status === 'fulfilled') comments.push(...result.value)
        else console.warn(`ingest failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
      }
      return comments
    },
    distill: (comments) => distillComments(comments, llm),
    gateway,
    store,
    minDemandScore: config.minDemandScore,
    superfanThreshold: config.superfanThreshold,
  }

  const notify = new TelegramNotifier({
    store,
    fallbackBotToken: config.telegramBotToken,
    log: (level, message) => console.log(`[telegram] ${level}: ${message}`),
  })
  const webhookNotify = new WebhookNotifier({
    store,
    log: (level, message) => console.log(`[webhook] ${level}: ${message}`),
  })
  pipelineDeps.notify = notify
  pipelineDeps.webhookNotify = webhookNotify

  const server = buildServer({ store, gateway, pipelineDeps, config, notify, webhookNotify })
  const workers = startWorkers({
    store,
    gateway,
    pipelineDeps,
    ingestIntervalMin: config.ingestIntervalMin,
    digestTime: config.digestTime,
    briefDay: config.briefDay,
    briefTime: config.briefTime,
    notify,
    webhookNotify,
  })

  return {
    store,
    gateway,
    pipelineDeps,
    notify,
    webhookNotify,
    start: async () => {
      await gateway.start?.()
      await server.listen({ port: config.port, host: '0.0.0.0' })
      console.log(`[app] CreatorSignal backend on :${config.port} (mind=${gateway.mode})`)
    },
    stop: async () => {
      workers.stop()
      await gateway.stop?.()
      await server.close()
      store.close()
    },
  }
}
