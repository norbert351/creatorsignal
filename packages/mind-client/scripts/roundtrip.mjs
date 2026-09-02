#!/usr/bin/env node
/**
 * Round-trip test: send a signals.batch + digest.request, then poll the
 * conversation for a NEW Mind reply and check whether it parses as a valid
 * FromMindMessage envelope (the goal of the CreatorSignal skill).
 *
 *   MINDS_BUILDER_API_KEY=<key> MIND_ID=<mindId> ALIAS=<alias> \
 *     node scripts/roundtrip.mjs
 */
import { createMindsClient } from '@animocabrands/minds-client-lib'

const key = process.env.MINDS_BUILDER_API_KEY
const mindId = process.env.MIND_ID
const alias = process.env.ALIAS ?? 'creatorsignal'
const verbose = process.env.VERBOSE === '1'
if (!key || !mindId) {
  console.error('Requires MINDS_BUILDER_API_KEY and MIND_ID env vars.')
  process.exit(1)
}
const client = createMindsClient({ builderApiKey: key })
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

await client.ensureConversation(alias, mindId)

// Snapshot: newest MIND reply timestamp we've already seen.
const before = await client.getHistory(alias, { limit: 5 })
const beforeMax = Math.max(0, ...before.map((h) => new Date(h.createdAt ?? 0).getTime()))

const now = new Date().toISOString()
const signalsEnvelope = {
  type: 'signals.batch',
  id: `rt-${Date.now()}`,
  sentAt: now,
  payload: {
    totalSignals: 2,
    signals: [
      {
        id: 'rt-s1', commentId: 'rt-c1', platform: 'youtube', videoId: 'rt-v1',
        authorId: 'rt-a1', authorName: 'RoundTrip Fan', kind: 'question',
        topic: 'live roundtrip topic', topicLabel: 'Live Roundtrip Topic',
        text: 'round trip probe question one', sentiment: 'neutral', ingestedAt: now,
      },
      {
        id: 'rt-s2', commentId: 'rt-c2', platform: 'youtube', videoId: 'rt-v2',
        authorId: 'rt-a2', authorName: 'RoundTrip Fan Two', kind: 'request',
        topic: 'live roundtrip topic', topicLabel: 'Live Roundtrip Topic',
        text: 'round trip probe request two', sentiment: 'neutral', ingestedAt: now,
      },
    ],
  },
}

log('sending signals.batch (2 signals)...')
await client.sendMessage({ alias, messageText: JSON.stringify(signalsEnvelope) })
log('sent. polling for a NEW Mind reply (45s)...')

// Poll history for a MIND message posted after our send.
let reply = null
const deadline = Date.now() + 45000
while (Date.now() < deadline) {
  const hist = await client.getHistory(alias, { limit: 10 })
  const candidates = hist.filter(
    (h) =>
      (h.senderType === 2 || h.senderType === 0 || h.mindName || h.senderId === mindId) &&
      new Date(h.createdAt ?? 0).getTime() > beforeMax,
  )
  if (candidates.length) {
    reply = [...candidates].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))[0]
    break
  }
  await new Promise((res) => setTimeout(res, 8000))
}

if (!reply) {
  log('NO new structured reply within 45s (Mind may still be processing or replied in prose).')
  process.exit(2)
}

log(`NEW MIND reply ${reply.createdAt}:`)
const text = (reply.messageText ?? '').replace(/<[^>]+>/g, '')
if (verbose) console.log(text.slice(0, 2000))
else console.log(text.slice(0, 400))

// Does it parse as a FromMindMessage envelope?
let parsed = null
try { parsed = JSON.parse(reply.messageText ?? '') } catch (e) { parsed = null }
if (parsed && parsed.type) {
  log(`\n✅ PARSED AS STRUCTURED ENVELOPE: type=${parsed.type}`)
  if (parsed.payload?.opportunity) log(`   opportunity: ${parsed.payload.opportunity.topicLabel} (demand ${parsed.payload.opportunity.demandScore}, status ${parsed.payload.opportunity.status})`)
  if (parsed.payload?.digest?.items) log(`   digest items: ${parsed.payload.digest.items.length}`)
  if (parsed.payload?.level) log(`   log level: ${parsed.payload.level}`)
  process.exit(0)
} else {
  log(`\n⚠️ Reply is NOT a structured FromMindMessage envelope (prose). type=${parsed?.type ?? 'none'}`)
  process.exit(3)
}