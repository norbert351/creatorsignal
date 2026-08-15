import { describe, expect, it } from 'vitest'
import { maskToken, resolveChatId } from './telegram-notify.js'

describe('resolveChatId', () => {
  it('keeps numeric chat ids', () => {
    expect(resolveChatId('123456789')).toBe('123456789')
    expect(resolveChatId('-1001234567890')).toBe('-1001234567890')
  })

  it('keeps @handles', () => {
    expect(resolveChatId('@mygroup')).toBe('@mygroup')
  })

  it('turns t.me links into handles', () => {
    expect(resolveChatId('t.me/mygroup')).toBe('@mygroup')
    expect(resolveChatId('https://t.me/mygroup')).toBe('@mygroup')
    expect(resolveChatId('https://telegram.me/mygroup')).toBe('@mygroup')
  })

  it('strips message-link suffixes', () => {
    expect(resolveChatId('https://t.me/mygroup/12345')).toBe('@mygroup')
  })

  it('trims whitespace', () => {
    expect(resolveChatId('  t.me/mygroup  ')).toBe('@mygroup')
  })
})

describe('maskToken', () => {
  it('masks everything for short tokens', () => {
    expect(maskToken('short')).toBe('••••')
  })

  it('keeps first 4 and last 4 chars', () => {
    expect(maskToken('1234567890abcdef')).toBe('1234…cdef')
  })
})
