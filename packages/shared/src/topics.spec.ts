import { describe, it, expect } from 'vitest'
import { normalizeTopic, topicLabel } from './topics.js'

describe('normalizeTopic', () => {
  it('clusters rephrasings of the same audience question', () => {
    const variants = [
      "why doesn't egypt claim bir tawil?",
      'why doesnt egypt claim bir tawil',
      "why won't egypt claim bir tawil",
      'why hasnt egypt claimed bir tawil yet',
      'why does egypt not claim bir tawil',
      'why is bir tawil not claimed by egypt',
      'egypt never claims bir tawil, why?',
    ]
    const keys = variants.map(normalizeTopic)
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toBe('bir claim egypt tawil')
  })

  it('separates distinct topics', () => {
    expect(normalizeTopic('explain the halaib triangle border')).not.toBe(
      normalizeTopic('why doesnt egypt claim bir tawil'),
    )
    expect(normalizeTopic('make a video on the minoan civilization')).toBe('minoan')
    expect(normalizeTopic('explain the bronze age collapse')).toBe('age bronze collapse')
  })

  it('handles empty and stopword-only input', () => {
    expect(normalizeTopic('???')).toBe('general')
    expect(normalizeTopic('please make a video')).toBe('general')
  })

  it('stems plurals into one key', () => {
    expect(normalizeTopic('cover the minoans next')).toBe('minoan')
    expect(normalizeTopic('minoan civilization when')).toBe('minoan')
  })
})

describe('topicLabel', () => {
  it('capitalizes tokens', () => {
    expect(topicLabel('bir claim egypt tawil')).toBe('Bir Claim Egypt Tawil')
    expect(topicLabel('general')).toBe('General')
  })
})
