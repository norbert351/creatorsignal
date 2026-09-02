import { MindsBuilderGateway } from '../dist/builder.js'

/**
 * Gateway-level live test: construct the REAL MindsBuilderGateway against the
 * live Zubbycrypt Mind, start its pump, send a signals.batch via the exact
 * production code path (processSignals), and wait to see onMessage dispatch a
 * parsed FromMindMessage envelope.
 *
 * The pump warms `seen` from history then streams new events; we introspect a
 * fresh alias so we can observe a genuinely NEW reply dispatch cleanly.
 */
const key = process.env.MINDS_BUILDER_API_KEY
const mindId = process.env.MIND_ID
if (!key || !mindId) {
  console.error('Requires MINDS_BUILDER_API_KEY and MIND_ID env vars.')
  process.exit(1)
}
const alias = `creatorsignal-gwtest-${Date.now()}`

const dispatched = []
const gateway = new MindsBuilderGateway({
  apiKey: key,
  mindId,
  alias,
  pollIntervalMs: 4000,
  onMessage: async (message) => {
    console.log(`\n[DISPATCH] onMessage received type=${message.type}`)
    dispatched.push(message)
    console.log(`  payload: ${JSON.stringify(message.payload).slice(0, 300)}`)
  },
  log: (level, msg) => console.log(`[gw ${level}] ${msg}`),
})

const t0 = Date.now()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await gateway.start()
console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] pump started on alias=${alias}`)

// Give the pump a moment to warm, then send a signals.batch through the gateway.
await wait(6000)
const now = new Date().toISOString()
await gateway.processSignals(
  [
    {
      id: 'gw-s1', commentId: 'gw-c1', platform: 'youtube', videoId: 'gw-v1',
      authorId: 'gw-a1', authorName: 'Gateway Test Fan', kind: 'question',
      topic: 'gateway live test topic', topicLabel: 'Gateway Live Test Topic',
      text: 'live gateway round-trip question', sentiment: 'neutral', ingestedAt: now,
    },
  ],
  {
    opportunities: [], fans: [], coveredTopics: new Set(),
    minDemandScore: 25, superfanThreshold: 30,
  },
)
console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] signals.batch sent via processSignals`)

// Wait up to ~90s for the Mind to reply and the pump to dispatch it.
const deadline = Date.now() + 90000
while (Date.now() < deadline && dispatched.length === 0) {
  await wait(8000)
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] waiting for dispatch...`)
}

await gateway.stop()
if (dispatched.length > 0) {
  console.log(`\n✅ GATEWAY LIVE ROUND-TRIP COMPLETE: ${dispatched.length} envelope(s) dispatched by onMessage.`)
  process.exit(0)
} else {
  console.log(`\n⚠️ No envelope dispatched in ${((Date.now() - t0) / 1000).toFixed(0)}s.`)
  process.exit(2)
}