import { randomUUID } from 'node:crypto'
import type { DigestItem, Fan, Opportunity, Signal } from '@creatorsignal/shared'

export interface DetectionOptions {
  /** Minimum demand score before a topic becomes an opportunity. */
  minDemandScore: number
  /** Normalized topics the creator already covered or approved. */
  coveredTopics: Set<string>
}

export interface DetectionResult {
  created: Opportunity[]
  updated: Opportunity[]
}

/**
 * The demand detection skill, implemented as a pure function so the same
 * logic can run inside the SimulatedMind (dev/demo) and be spec'd out for
 * the real Mind's skills.
 *
 * Demand score: 3 per repeated ask, 5 per video the topic spans, 12 bonus
 * when the topic has never been answered.
 */
export function detectOpportunities(
  signals: Signal[],
  existing: Opportunity[],
  options: DetectionOptions,
): DetectionResult {
  const clusters = new Map<string, Signal[]>()
  for (const signal of signals) {
    const cluster = clusters.get(signal.topic)
    if (cluster) cluster.push(signal)
    else clusters.set(signal.topic, [signal])
  }

  const created: Opportunity[] = []
  const updated: Opportunity[] = []
  const now = new Date().toISOString()

  for (const [topic, cluster] of clusters) {
    const repeatCount = cluster.length
    const videoCount = new Set(cluster.map((s) => s.videoId)).size
    const relatedAuthorIds = [...new Set(cluster.map((s) => s.authorId))]
    const unanswered = !options.coveredTopics.has(topic)
    const demandScore = Math.round(
      repeatCount * 3 + videoCount * 5 + (unanswered ? 12 : 0),
    )
    const topicLabel =
      [...cluster]
        .map((s) => s.topicLabel)
        .sort((a, b) => b.length - a.length)[0] ?? topic

    const previous = existing.find((o) => o.topic === topic)
    if (previous) {
      updated.push({
        ...previous,
        demandScore,
        repeatCount,
        videoCount,
        unanswered,
        relatedAuthorIds,
        lastSeenAt: now,
      })
    } else if (demandScore >= options.minDemandScore) {
      created.push({
        id: randomUUID(),
        topic,
        topicLabel,
        demandScore,
        repeatCount,
        videoCount,
        unanswered,
        status: 'open',
        relatedAuthorIds,
        firstSeenAt: now,
        lastSeenAt: now,
      })
    }
  }

  return { created, updated }
}

export interface FanOptions {
  /** Only authors at or above this score count as superfans. */
  superfanThreshold: number
}

/**
 * Relationship memory, derived: who keeps showing up, what they care about,
 * how engaged they are. Score: 6 per engagement, 12 per question asked,
 * capped at 100.
 */
export function computeFans(signals: Signal[], options: FanOptions): Fan[] {
  const byAuthor = new Map<string, Signal[]>()
  for (const signal of signals) {
    const list = byAuthor.get(signal.authorId)
    if (list) list.push(signal)
    else byAuthor.set(signal.authorId, [signal])
  }

  const fans: Fan[] = []
  for (const [authorId, authorSignals] of byAuthor) {
    const engagementCount = authorSignals.length
    const questionCount = authorSignals.filter((s) => s.kind === 'question' || s.kind === 'request').length
    const topics = [...new Set(authorSignals.map((s) => s.topic))].slice(0, 12)
    const lastActiveAt = authorSignals
      .map((s) => s.ingestedAt)
      .sort()
      .at(-1)
    const first = authorSignals[0]
    const name = first?.authorName ?? authorId
    fans.push({
      authorId,
      name,
      engagementCount,
      questionCount,
      topics,
      superfanScore: Math.min(100, Math.round(engagementCount * 6 + questionCount * 12)),
      lastActiveAt: lastActiveAt ?? new Date().toISOString(),
    })
  }
  return fans.filter((f) => f.superfanScore >= options.superfanThreshold)
}

export interface DigestOptions {
  /** Opportunity ids that are new since the last run. */
  newlyCreatedIds: string[]
  /** How many items per digest section. */
  maxItems: number
}

/**
 * The daily digest skill: top audience opportunities plus the superfans
 * attached to them, composed as ranked items.
 */
export function composeDigest(
  opportunities: Opportunity[],
  fans: Fan[],
  options: DigestOptions,
): DigestItem[] {
  const items: DigestItem[] = []

  for (const id of options.newlyCreatedIds) {
    const opp = opportunities.find((o) => o.id === id)
    if (opp) {
      items.push({
        type: 'alert',
        refId: opp.id,
        title: 'New audience opportunity detected',
        body: `${opp.topicLabel} has ${opp.repeatCount} asks across ${opp.videoCount} videos and is still unanswered`,
        score: opp.demandScore,
      })
    }
  }

  const actionable = opportunities
    .filter((o) => o.status === 'open' || o.status === 'proposed')
    .sort((a, b) => b.demandScore - a.demandScore)
    .slice(0, options.maxItems)
  for (const opp of actionable) {
    items.push({
      type: 'opportunity',
      refId: opp.id,
      title: opp.topicLabel,
      body: `${opp.repeatCount} asks across ${opp.videoCount} videos, ${opp.unanswered ? 'unanswered' : 'covered'} · demand ${opp.demandScore}`,
      score: opp.demandScore,
    })
  }

  const topFans = [...fans]
    .sort((a, b) => b.superfanScore - a.superfanScore)
    .slice(0, options.maxItems)
  for (const fan of topFans) {
    items.push({
      type: 'fan',
      refId: fan.authorId,
      title: fan.name,
      body: `${fan.superfanScore}/100 superfan · ${fan.engagementCount} engagements, ${fan.questionCount} questions`,
      score: fan.superfanScore,
    })
  }

  return items
}
