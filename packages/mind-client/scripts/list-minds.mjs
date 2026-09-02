#!/usr/bin/env node
/**
 * List your Minds' IDs from the Minds Builder API.
 *
 * Usage:
 *   MINDS_BUILDER_API_KEY=<your key> node scripts/list-minds.mjs
 *
 * Prints every Mind you own/are a member of with its mindId + name. The
 * mindId is exactly what CreatorSignal needs as CREATORSIGNAL_MINDS_MIND_ID.
 *
 * No key? Two-step signup:
 *   1. Create a free Mind / get an account at https://build.hellominds.ai
 *   2. Make a Builder API key at https://build.hellominds.ai/console
 *      (labeled "Builder API key" — it's a JWT with a humanId claim).
 */
import { createMindsClient } from '@animocabrands/minds-client-lib'

const key = process.env.MINDS_BUILDER_API_KEY
if (!key) {
  console.error('Missing MINDS_BUILDER_API_KEY.')
  console.error('Create one at https://build.hellominds.ai/console then:')
  console.error('  MINDS_BUILDER_API_KEY=<key> node scripts/list-minds.mjs')
  process.exit(1)
}

const client = createMindsClient({ builderApiKey: key })
const minds = await client.listMinds()

if (minds.length === 0) {
  console.log('No Minds found for this account yet.')
  console.log('Awaken one first (or pass MINDS_API_KEY to awakenMind), then re-run.')
  process.exit(0)
}

console.log(`\n${minds.length} Mind(s) on this account:\n`)
for (const m of minds) {
  console.log(`  mindId:      ${m.mindId}`)
  console.log(`  name:        ${m.name ?? '(unnamed)'}`)
  console.log(`  model:       ${m.model ?? '?'}`)
  console.log(`  species:     ${m.species ?? '?'}`)
  console.log(`  enabled:     ${m.isEnabled ?? '?'}`)
  console.log(`  -------------`)
}
console.log(`\nSet CREATORSIGNAL_MINDS_MIND_ID=<the mindId you want> in the backend env.\n`)