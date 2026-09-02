#!/usr/bin/env node
/**
 * Live probe against a real Minds Builder Mind: creates the CreatorSignal
 * conversation, sends one signals.batch envelope, and waits for any reply —
 * proving the gateway's ensureConversation + sendMessage + reply path works
 * end-to-end against the live Mind.
 *
 *   MINDS_BUILDER_API_KEY=<key> MIND_ID=<mindId> node scripts/probe-live.mjs
 */
import { createMindsClient } from '@animocabrands/minds-client-lib'

const key = process.env.MINDS_BUILDER_API_KEY
const mindId = process.env.MIND_ID
const alias = process.env.ALIAS ?? 'creatorsignal-probe'
if (!key || !mindId) {
  console.error('Requires MINDS_BUILDER_API_KEY and MIND_ID env vars.')
  process.exit(1)
}

const client = createMindsClient({ builderApiKey: key })
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

log(`resolving conversation alias=${alias} mind=${mindId} ...`)
const conv = await client.ensureConversation(alias, mindId)
log(`conversation ready: ${conv.conversationId}`)

const now = new Date().toISOString()
const envelope = {
  type: 'signals.batch',
  id: `probe-${Date.now()}`,
  sentAt: now,
  payload: {
    totalSignals: 1,
    signals: [
      {
        id: 'probe-s1',
        commentId: 'probe-c1',
        platform: 'youtube',
        videoId: 'probe-v1',
        authorId: 'probe-a1',
        authorName: 'Probe Fan',
        kind: 'question',
        topic: 'creator signal probe',
        topicLabel: 'Creator Signal Probe',
        text: 'this is a live round-trip probe from CreatorSignal',
        sentiment: 'neutral',
        ingestedAt: now,
      },
    ],
  },
}
log('sending signals.batch envelope...')
await client.sendMessage({ alias, messageText: JSON.stringify(envelope) })
log('sent. waiting for a Mind reply (12s)...')

const outcome = await client.waitForReply({ alias, timeoutMs: 12000, sentMessageText: JSON.stringify(envelope) })
if (outcome.timedOut) {
  log('NO reply within timeout (Mind did not respond to a raw envelope — expected until skills are wired).')
  process.exit(2)
}
log('REPLY RECEIVED:')
const reply = outcome.reply
log(`  fingerprint: ${reply.fingerprint}`)
log(`  senderType: ${reply.senderType}  senderName: ${reply.senderName ?? reply.mindName ?? '?'}`)
log(`  text: ${(reply.messageText ?? '').slice(0, 400)}`)

// Try to parse it as a FromMindMessage.
try {
  const parsed = JSON.parse(reply.messageText ?? '')
  log(`  parsed as JSON, type=${parsed.type}`)
  process.exit(0)
} catch {
  log('  (reply is not JSON — Mind sent a plain message, not a FromMindMessage envelope)')
  process.exit(0)
}