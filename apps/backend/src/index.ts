import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { loadEnvFile } from './envfile.js'

async function main(): Promise<void> {
  loadEnvFile()
  const config = loadConfig(process.env)
  const app = createApp(config)

  const shutdown = async (): Promise<void> => {
    console.log('[app] shutting down')
    await app.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  await app.start()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
