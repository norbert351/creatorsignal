#!/usr/bin/env node
/**
 * Dump the message history of the CreatorSignal conversation so we can see
 * whether the Mind replied to our envelopes AT ALL (even with plain text).
 *
 *   MINDS_BUILDER_API_KEY=<key> MIND_ID=<mindId> ALIAS=<alias> node scripts/dump-history.mjs
 */
import { createMindsClient } from '@animocabrands/minds-client-lib'

const key = process.env.MINDS_BUILDER_API_KEY
const mindId = process.env.MIND_ID
const alias = process.env.ALIAS ?? 'creatorsignal'
if (!key || !mindId) {
  console.error('Requires MINDS_BUILDER_API_KEY and MIND_ID env vars.')
  process.exit(1)
}
const client = createMindsClient({ builderApiKey: key })
const log = (...a) => console.log(...a)

log(`=== history for alias=${alias} (mind=${mindId}) ===`)
try {
  const conv = await client.getConversation(alias)
  log(`conversation: ${conv.conversationId}  subject=${conv.subject ?? ''}`)
} catch (e) { log(`getConversation: ${e.message}`) }

try {
  const history = await client.getHistory(alias, { limit: 20 })
  log(`\nentries: ${history.length}\n`)
  for (const h of history) {
    const sender = h.senderType === 2 || h.senderType === 0 ? `MIND(${h.mindName ?? h.senderName ?? h.senderEmail ?? '?'})` : `HUMAN(${h.senderName ?? h.senderEmail ?? '?'})`
    const text = (h.messageText ?? '').slice(0, 300)
    log(`[${h.createdAt ?? ''}] ${sender}\n  ${text}\n`)
  }
} catch (e) { log(`getHistory: ${e.message}`) }

// Bazaar — is there a skills authoring surface on the API at all?
log(`\n=== BAZAAR: 5 most-equipped skills ===`)
try {
  const page = await client.bazaar.listSkills({ page: 1, pageSize: 5 })
  log(`total skills: ${page.totalCount}`)
  for (const s of page.items) log(`  ${s.skillId} · ${s.name} · ${s.source} · equipped=${s.equippedCount}`)
} catch (e) { log(`bazaar.listSkills: ${e.message}`) }