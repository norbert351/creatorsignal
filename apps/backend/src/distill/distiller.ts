import { randomUUID } from 'node:crypto'
import { normalizeTopic, topicLabel, type Comment, type Sentiment, type Signal, type SignalKind } from '@creatorsignal/shared'
import type { LlmClient } from './llm.js'

const QUESTION_LEADERS = [
  'why', 'what', 'how', 'when', 'where', 'who', 'which',
  'can', 'could', 'do', 'does', 'did', 'is', 'are', 'will', 'would', 'should', 'has', 'have',
]

const REQUEST_PATTERN = /\b(make|please|tutorial|explain|cover|do a video|video on|content on|series on|part 2|next)\b/
const PRAISE_PATTERN = /\b(love|amazing|great|awesome|best|thank|favorite|fantastic|genius|incredible|brilliant|underrated)\b/
const CRITIQUE_PATTERN = /\b(bad|hate|worst|boring|dislike|terrible|weak|wrong|confusing|slow|low)\b/

/**
 * Deterministic classifier, used when no LLM key is configured and as the
 * per-comment fallback when the LLM batch fails. Keeps the pipeline fully
 * functional for the demo without external dependencies.
 */
export function classifyComment(text: string): { kind: SignalKind; sentiment: Sentiment } {
  const lower = text.toLowerCase().trim()
  const firstWord = lower.split(/\s+/)[0] ?? ''
  const isQuestion = lower.includes('?') || QUESTION_LEADERS.includes(firstWord)
  const isRequest = !isQuestion && REQUEST_PATTERN.test(lower)
  const isPraise = PRAISE_PATTERN.test(lower)
  const isCritique = CRITIQUE_PATTERN.test(lower)

  let kind: SignalKind
  if (isQuestion) kind = 'question'
  else if (isRequest) kind = 'request'
  else if (isPraise) kind = 'praise'
  else if (isCritique) kind = 'critique'
  else kind = 'topic'

  const sentiment: Sentiment = isPraise ? 'positive' : isCritique ? 'negative' : 'neutral'
  return { kind, sentiment }
}

/** Distills raw comments into memory-ready signals. */
export async function distillComments(
  comments: Comment[],
  llm: LlmClient | null,
): Promise<Signal[]> {
  const signals: Signal[] = []

  if (llm && comments.length > 0) {
    try {
      const results = await llm.classifyBatch(comments)
      for (let i = 0; i < comments.length; i++) {
        const comment = comments[i]
        const result = results[i]
        if (!comment || !result) continue
        const topic = normalizeTopic(`${result.topic} ${comment.text}`)
        signals.push({
          id: randomUUID(),
          commentId: comment.id,
          platform: comment.platform,
          videoId: comment.videoId,
          authorId: comment.authorId,
          authorName: comment.authorName,
          kind: result.kind,
          topic,
          topicLabel: topicLabel(topic),
          text: comment.text,
          sentiment: result.sentiment,
          ingestedAt: comment.ingestedAt,
        })
      }
      return signals
    } catch (error) {
      console.warn(`llm distill failed, using fallback: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const comment of comments) {
    const { kind, sentiment } = classifyComment(comment.text)
    const topic = normalizeTopic(comment.text)
    signals.push({
      id: randomUUID(),
      commentId: comment.id,
      platform: comment.platform,
      videoId: comment.videoId,
      authorId: comment.authorId,
      authorName: comment.authorName,
      kind,
      topic,
      topicLabel: topicLabel(topic),
      text: comment.text,
      sentiment,
      ingestedAt: comment.ingestedAt,
    })
  }
  return signals
}
