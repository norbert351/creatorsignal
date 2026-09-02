#!/usr/bin/env node
/**
 * Poll the CreatorSignal conversation until the Mind replies to the most
 * recent HUMAN message (the skill instruction), then print the reply.
 *
 *   MINDS_BUILDER_API_KEY=<key> MIND_ID=<mindId> ALIAS=<alias> \
 *     DURATION_SECS=<n> node scripts/poll-build.mjs
 */
import { createMindsClient } from '@animocabrands/minds-client-lib'

const key = process.env.MINDS_BUILDER_API_KEY
const mindId = process.env.MIND_ID
const alias = process.env.ALIAS ?? 'creatorsignal'
const duration = Number(process.env.DURATION_SECS ?? 180)
if (!key || !mindId) {
  console.error('Requires MINDS_BUILDER_API_KEY and MIND_ID env vars.')
  process.exit(1)
}
const client = createMindsClient({ builderApiKey: key })
const t0 = Date.now()
const deadline = t0 + duration * 1000
let lastSeenMin = 0

console.log(`polling ${alias} for up to ${duration}s...`)
while (Date.now() < deadline) {
  try {
    const history = await client.getHistory(alias, { limit: 8 })
    const sorted = [...history].sort((a, b) =>
      (a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
    )
    // human messages that mention "Skill" = our instruction
    const lastHuman = [...sorted].reverse().find((h) => h.messageText?.includes('CreatorSignal Skill'))
    const selfMsgTs = lastHuman ? new Date(lastHuman.createdAt ?? 0).getTime() : null
    const replies = selfMsgTs
      ? sorted.filter(
          (h) =>
            (h.senderType === 2 || h.senderType === 0) &&
            new Date(h.createdAt ?? 0).getTime() >= selfMsgTs,
        )
      : []
    if (replies.length > 0) {
      console.log(`\n[${((Date.now() - t0) / 1000).toFixed(0)}s] MIND replied after the skill instruction (${replies.length} msg):\n`)
      for (const r of replies) {
        console.log(`--- ${r.createdAt} (${r.mindName ?? r.senderName ?? 'mind'}) ---`)
        const text = (r.messageText ?? '').replace(/<[^>]+>/g, '')
        console.log(text.slice(0, 2500) + '\n')
      }
      process.exit(0)
    }
  } catch (e) {
    // transient — ignore
  }
  await new Promise((res) => setTimeout(res, 15000))
}
console.log(`\nNo Mind reply to the skill instruction within ${duration}s — still building or queued.`)
try {
  const skills = await client.listEquippedSkills(mindId)
  console.log(`Equipped skills now (${skills.length}): ${skills.map((s) => s.name).join(', ')}`)
} catch {}
process.exit(2)