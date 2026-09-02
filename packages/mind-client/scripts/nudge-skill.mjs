#!/usr/bin/env node
/**
 * Short, direct prompt to trigger the Mind's skill-build loop (the documented
 * "describe it to your Mind" pattern). Resends concise build instruction.
 *
 *   MINDS_BUILDER_API_KEY=<key> MIND_ID=<mindId> ALIAS=<alias> node scripts/nudge-skill.mjs
 */
import { createMindsClient } from '@animocabrands/minds-client-lib'

const key = process.env.MINDS_BUILDER_API_KEY
const mindId = process.env.MIND_ID
const alias = process.env.ALIAS ?? 'creatorsignal'
if (!key || !mindId) {
  console.error('Requires MINDS_BUILDER_API_KEY and MIND_ID env vars.')
  process.exit(1)
}

const SHORT = `Build me a Skill. You are the Mind for CreatorSignal, an audience-intelligence
agent for a content creator.

This conversation receives JSON envelopes from the creator's backend, all as raw
JSON text messages:
- {"type":"signals.batch","payload":{"signals":[...]}} — distilled audience
  signals (kind: question|request|topic|praise|critique; each has a topic,
  authorId, authorName, text).
- {"type":"decision","payload":{"opportunityId","topic","decision":
  "approved|rejected","note"}} — the creator's decision on an opportunity.
- {"type":"digest.request","payload":{}} — asks for today's digest.

The Skill must do this: on signals.batch, remember authors and topics in your
memory; cluster signals by topic; when a topic's demand builds (repeatCount*3 +
videoCount*5 + 12 if unanswered) >= 25, emit exactly this JSON envelope:
{"type":"opportunity.created","id":"<uuid>","receivedAt":"<iso>","payload":
{"opportunity":{"id":"<uuid>","topic":"<slug>","topicLabel":"<label>",
"demandScore":0,"repeatCount":0,"videoCount":0,"unanswered":true,
"status":"open","relatedAuthorIds":[],"firstSeenAt":"<iso>",
"lastSeenAt":"<iso>"}}}.

On digest.request reply with {"type":"digest","payload":{"digest":{"items":[
{"type":"opportunity","refId","title","body","score"}, ...ranked by demand]}}}.

CRITICAL:BEGIN—ALWAYS reply in the exact JSON envelope described (never prose),
so the backend can parse you. This is the single most important rule. CRITICAL:END.

Confirm with a short "log" envelope {"type":"log","payload":{"level":"info",
"message":"CreatorSignal Skill built"}} when complete. Build it now.`

const client = createMindsClient({ builderApiKey: key })
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

await client.ensureConversation(alias, mindId)
await client.sendMessage({ alias, messageText: SHORT })
log(`sent concise build command (${SHORT.length} chars).`)
log('waiting for the Mind (45s)...')
const outcome = await client.waitForReply({ alias, timeoutMs: 45000, sentMessageText: SHORT })
if (outcome.timedOut) {
  log('no reply in 45s.')
  process.exit(2)
}
log('REPLY:')
console.log((outcome.reply.messageText ?? '').replace(/<[^>]+>/g, '').slice(0, 800))
process.exit(0)