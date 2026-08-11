import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { loadEnvFile } from './envfile.js'
import { runPipeline } from './pipeline.js'
import { seedDatabase } from './seed.js'

/**
 * Seeds the demo dataset and runs the full pipeline with the simulated Mind,
 * then prints a summary. Used by `pnpm seed`.
 */
async function main(): Promise<void> {
  loadEnvFile()
  const config = loadConfig(process.env)
  const app = createApp(config, 'simulated')
  try {
    const seeded = seedDatabase(app.store)
    console.log(`seeded ${seeded} demo comments`)
    const summary = await runPipeline(app.pipelineDeps, ['distill', 'relay'])
    console.log(JSON.stringify(summary, null, 2))
    const opportunities = app.store.listOpportunities()
    console.log(`\nTop opportunities:`)
    for (const opp of opportunities.slice(0, 5)) {
      console.log(
        `  ${opp.topicLabel} | asks=${opp.repeatCount} videos=${opp.videoCount} ` +
          `unanswered=${opp.unanswered} demand=${opp.demandScore} status=${opp.status}`,
      )
    }
    const topFans = app.store.listFans(60)
    console.log(`\nSuperfans (score >= 60): ${topFans.length}`)
    for (const fan of topFans.slice(0, 5)) {
      console.log(`  ${fan.name} | score=${fan.superfanScore} engagements=${fan.engagementCount}`)
    }
  } finally {
    await app.stop()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
