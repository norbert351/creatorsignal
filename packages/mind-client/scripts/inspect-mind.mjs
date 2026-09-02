#!/usr/bin/env node
/**
 * Inspect a Mind's current skills/apps + what the Bazaar offers, via the
 * Builder API. Uses the SAME client the gateway uses, so if a method exists
 * in the lib we probe it live.
 *
 *   MINDS_BUILDER_API_KEY=<key> MIND_ID=<mindId> node scripts/inspect-mind.mjs
 */
import { createMindsClient } from '@animocabrands/minds-client-lib'

const key = process.env.MINDS_BUILDER_API_KEY
const mindId = process.env.MIND_ID
if (!key || !mindId) {
  console.error('Requires MINDS_BUILDER_API_KEY and MIND_ID env vars.')
  process.exit(1)
}
const client = createMindsClient({ builderApiKey: key })

function show(label, value) {
  console.log(`\n=== ${label} ===`)
  console.log(JSON.stringify(value, null, 2).slice(0, 4000))
}

try {
  const mind = await client.getMind(mindId)
  show('MIND', { mindId: mind.mindId, name: mind.name, model: mind.model, species: mind.species, telegram: mind.telegramBotId })
} catch (e) { console.log(`\n=== getMind FAILED: ${e.message} ===`) }

try {
  const skills = await client.listEquippedSkills(mindId)
  show(`EQUIPPED SKILLS (${skills.length})`, skills)
} catch (e) { console.log(`\n=== listEquippedSkills FAILED: ${e.message} ===`) }

try {
  const apps = await client.listEquippedApps(mindId)
  show(`EQUIPPED APPS (${apps.length})`, apps)
} catch (e) { console.log(`\n=== listEquippedApps FAILED: ${e.message} ===`) }

try {
  const bal = await client.getCognitionBalance(mindId)
  show('COGNITION BALANCE', bal)
} catch (e) { console.log(`\n=== getCognitionBalance FAILED: ${e.message} ===`) }

try {
  const circle = await client.getCircle(mindId)
  show(`CIRCLE MEMBERS (${circle.length})`, circle.map(m => ({ email: m.email, name: m.name, isSteward: m.isSteward, partyType: m.partyType })))
} catch (e) { console.log(`\n=== getCircle FAILED: ${e.message} ===`) }

try {
  const convos = await client.listConversations()
  show(`CONVERSATIONS (${convos.length})`, convos.slice(0, 10))
} catch (e) { console.log(`\n=== listConversations FAILED: ${e.message} ===`) }