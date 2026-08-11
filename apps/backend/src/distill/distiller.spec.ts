import { describe, it, expect } from 'vitest'
import { classifyComment, distillComments } from './distiller.js'

describe('classifyComment', () => {
  it('detects questions', () => {
    expect(classifyComment('why doesnt egypt claim bir tawil?').kind).toBe('question')
    expect(classifyComment('why doesnt egypt claim bir tawil').kind).toBe('question')
    expect(classifyComment('when is the next video').kind).toBe('question')
    expect(classifyComment('does anyone know the answer').kind).toBe('question')
  })

  it('detects content requests', () => {
    expect(classifyComment('make a video on the minoan civilization').kind).toBe('request')
    expect(classifyComment('please explain the halaib triangle').kind).toBe('request')
    expect(classifyComment('please do the bronze age collapse next').kind).toBe('request')
    expect(classifyComment('a tutorial on enclaves would be great').kind).toBe('request')
  })

  it('detects praise and critique', () => {
    expect(classifyComment('love the bir tawil episode').kind).toBe('praise')
    expect(classifyComment('amazing content as always').kind).toBe('praise')
    expect(classifyComment('the audio was a bit low').kind).toBe('critique')
  })

  it('maps sentiment', () => {
    expect(classifyComment('you are amazing').sentiment).toBe('positive')
    expect(classifyComment('this is the worst episode').sentiment).toBe('negative')
    expect(classifyComment('when is the next video').sentiment).toBe('neutral')
  })

  it('falls back to topic for plain statements', () => {
    expect(classifyComment('the maps in this channel are cool').kind).toBe('topic')
  })
})

describe('distillComments', () => {
  it('produces one signal per comment with normalized topics, no LLM needed', async () => {
    const comments = [
      {
        id: 'c1',
        videoId: 'v1',
        authorId: 'a1',
        authorName: 'Fan One',
        text: 'why doesnt egypt claim bir tawil',
        publishedAt: '2026-08-01T00:00:00.000Z',
        ingestedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'c2',
        videoId: 'v2',
        authorId: 'a2',
        authorName: 'Fan Two',
        text: 'love this channel',
        publishedAt: '2026-08-01T00:00:00.000Z',
        ingestedAt: '2026-08-01T00:00:00.000Z',
      },
    ]
    const signals = await distillComments(comments, null)
    expect(signals).toHaveLength(2)
    const first = signals[0]
    if (!first) throw new Error('missing signal')
    expect(first.kind).toBe('question')
    expect(first.topic).toBe('bir claim egypt tawil')
    const second = signals[1]
    if (!second) throw new Error('missing signal')
    expect(second.kind).toBe('praise')
    expect(second.sentiment).toBe('positive')
  })
})
