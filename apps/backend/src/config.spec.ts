import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('maps CREATORSIGNAL_ env vars to camelCase config keys', () => {
    const config = loadConfig({
      CREATORSIGNAL_PORT: '4123',
      CREATORSIGNAL_MIND_MODE: 'telegram',
      CREATORSIGNAL_TELEGRAM_BOT_TOKEN: '123456:ABC-DEF',
      CREATORSIGNAL_TELEGRAM_GROUP_ID: '-100123',
      CREATORSIGNAL_YOUTUBE_VIDEO_IDS: 'aaa,bbb, ccc',
      CREATORSIGNAL_SEED_ON_BOOT: 'true',
      CREATORSIGNAL_API_TOKEN: 'test-secret-123',
    })
    expect(config.port).toBe(4123)
    expect(config.mindMode).toBe('telegram')
    expect(config.telegramBotToken).toBe('123456:ABC-DEF')
    expect(config.telegramGroupId).toBe('-100123')
    expect(config.youtubeVideoIds).toEqual(['aaa', 'bbb', 'ccc'])
    expect(config.seedOnBoot).toBe(true)
    expect(config.apiToken).toBe('test-secret-123')
  })

  it('applies defaults when nothing is set', () => {
    const config = loadConfig({})
    expect(config.port).toBe(3500)
    expect(config.mindMode).toBe('simulated')
    expect(config.dbPath).toBe('./data/creatorsignal.sqlite')
    expect(config.apiToken).toBeUndefined()
  })

  it('rejects telegram mode without credentials', () => {
    expect(() => loadConfig({ CREATORSIGNAL_MIND_MODE: 'telegram' })).toThrow(/telegram/)
  })

  it('ignores unrelated env vars, including leaked globals', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://arc', PORT: '3000', NODE_ENV: 'production' })
    expect(config.port).toBe(3500)
  })
})
