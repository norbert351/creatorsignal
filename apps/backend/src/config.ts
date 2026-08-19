import { z } from 'zod'

// Every env var is CREATORSIGNAL_ prefixed so a shared host can never leak
// DATABASE_URL, PORT, or NODE_ENV into this app.

export const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3500),
  dbPath: z.string().default('./data/creatorsignal.sqlite'),
  mindMode: z.enum(['simulated', 'telegram']).default('simulated'),
  logLevel: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  youtubeApiKey: z.string().optional(),
  youtubeVideoIds: z.array(z.string()).default([]),
  youtubeChannelId: z.string().optional(),
  tiktokApiKey: z.string().optional(),
  tiktokVideoIds: z.array(z.string()).default([]),
  xBearerToken: z.string().optional(),
  xUserIds: z.array(z.string()).default([]),
  xQuery: z.string().optional(),
  llmApiKey: z.string().optional(),
  llmBaseUrl: z.string().default('https://api.openai.com/v1'),
  llmModel: z.string().default('gpt-4o-mini'),
  telegramBotToken: z.string().optional(),
  telegramGroupId: z.string().optional(),
  ingestIntervalMin: z.coerce.number().int().positive().default(30),
  digestTime: z.string().regex(/^\d{2}:\d{2}$/, 'must be HH:MM').default('09:00'),
  /** Weekly content brief: day of week (0=Sunday..6=Saturday) + time. */
  briefDay: z.coerce.number().int().min(0).max(6).default(1),
  briefTime: z.string().regex(/^\d{2}:\d{2}$/, 'must be HH:MM').default('09:00'),
  minDemandScore: z.coerce.number().int().nonnegative().default(25),
  superfanThreshold: z.coerce.number().int().nonnegative().default(30),
  ingestDaysBack: z.coerce.number().int().positive().default(30),
  /** When set, /api/* requires `authorization: Bearer *** */
  apiToken: z.string().min(8).optional(),
  /** Viewer login gate. 'on' (default) shares the API behind account auth.
   *  'off' restores the open single-workspace behaviour.
   *  Env: CREATORSIGNAL_AUTH */
  auth: z.enum(['on', 'off']).default('on'),
})
export type Config = z.infer<typeof configSchema>

function csv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

/** CREATORSIGNAL_PORT -> port, CREATORSIGNAL_YOUTUBE_VIDEO_IDS -> youtubeVideoIds */
function toCamelCase(key: string): string {
  return key.toLowerCase().replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const raw: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('CREATORSIGNAL_')) {
      raw[toCamelCase(key.slice('CREATORSIGNAL_'.length))] = value
    }
  }
  const parsed = configSchema.safeParse({
    ...raw,
    youtubeVideoIds: raw.youtubeVideoIds ? csv(raw.youtubeVideoIds) : undefined,
  })
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`invalid CREATORSIGNAL_* configuration:\n${details}`)
  }
  const config = parsed.data
  if (config.mindMode === 'telegram') {
    if (!config.telegramBotToken || !config.telegramGroupId) {
      throw new Error(
        'mindMode=telegram requires CREATORSIGNAL_TELEGRAM_BOT_TOKEN and CREATORSIGNAL_TELEGRAM_GROUP_ID',
      )
    }
  }
  return config
}
