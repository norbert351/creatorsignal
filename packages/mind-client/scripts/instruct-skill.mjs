#!/usr/bin/env node
/**
 * Instruct the live Mind to build the CreatorSignal Skill.
 *
 * The Builder API has no createSkill endpoint — skills are authored by
 * describing them to the Mind conversationally ("your Mind builds it" — see
 * build.hellominds.ai/docs/guides/building-skills). Since our gateway holds a
 * live conversation with the Mind, we send the full envelope-protocol spec as
 * an instruction and ask it to (1) build the skill and (2) begin replying with
 * structured FromMindMessage envelopes.
 *
 *   MINDS_BUILDER_API_KEY=<key> MIND_ID=<mindId> ALIAS=<alias> \
 *     node scripts/instruct-skill.mjs
 */
import { createMindsClient } from '@animocabrands/minds-client-lib'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const key = process.env.MINDS_BUILDER_API_KEY
const mindId = process.env.MIND_ID
const alias = process.env.ALIAS ?? 'creatorsignal'
if (!key || !mindId) {
  console.error('Requires MINDS_BUILDER_API_KEY and MIND_ID env vars.')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const spec =
  process.env.SPEC_FILE
    ? readFileSync(join(here, process.env.SPEC_FILE), 'utf8')
    : readFileSync(join(here, 'creatorsignal-skill-spec.md'), 'utf8')

const instruction = spec + `\n\nBuild this Skill now. Then, from now on, whenever you receive a message in a
"signals.batch", "decision", or "digest.request" envelope in this conversation,
respond with the corresponding FromMindMessage JSON envelope(s) as shown above
(opportunity.created / opportunity.updated / digest / reply.draft / log), exactly
matching the schemas. Do not respond with prose. Keep your memory updated as the
protocol describes. Confirm when built.`

const client = createMindsClient({ builderApiKey: key })
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

log(`sending CreatorSignal Skill spec to alias=${alias} mind=${mindId} (${spec.length} chars spec)...`)
await client.ensureConversation(alias, mindId)
await client.sendMessage({ alias, messageText: instruction })
log('sent. waiting for the Mind to build + confirm (60s)...')

const outcome = await client.waitForReply({ alias, timeoutMs: 60000, sentMessageText: instruction })
if (outcome.timedOut) {
  log('NO confirmation within 60s. The Mind may still be building (skills can take time).')
  log('Check later via: node scripts/dump-history.mjs (look for a MIND reply in the alias).')
  process.exit(2)
}
log('REPLY RECEIVED from the Mind:')
console.log((outcome.reply.messageText ?? '').slice(0, 1200))
// Re-send the instruction as direct JSON envelope text so it's unambiguous? No — plain ask is right.
process.exit(0)