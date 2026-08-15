import { randomUUID } from 'node:crypto'
import type { Store } from './db.js'

/**
 * The autonomous weekly content brief.
 *
 * The Mind looks at what the audience has been asking for, what the creator
 * already covered, and drafts "here's what to make next" — with evidence.
 * Runs on a schedule (workers) and on demand (viewer button), and is pushed
 * to the creator's Telegram group when one is connected.
 */

export interface ContentBriefItem {
  topic: string
  topicLabel: string
  demandScore: number
  repeatCount: number
  videoCount: number
  unanswered: boolean
  askers: string[]
  angle: string
}

export interface ContentBrief {
  id: string
  generatedAt: string
  period: string
  headline: string
  items: ContentBriefItem[]
}

function periodLabel(from: Date): string {
  const end = new Date(from)
  end.setDate(end.getDate() + 7)
  const fmt = (d: Date): string =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(from)} – ${fmt(end)}`
}

function angleFor(topicLabel: string, unanswered: boolean): string {
  if (unanswered) {
    return `Answer it directly — viewers asked and nobody has responded. A short explainer with a pinned reply.`
  }
  return `Expand the topic: compare angles, break down the details, or turn the most-asked sub-question into its own video.`
}

/**
 * Rule-based brief. Deterministic and LLM-free so it always works on the
 * demo deploy (no key needed). Sorted by demand, covered topics excluded.
 */
export function composeContentBrief(store: Store, maxItems = 3): ContentBrief {
  const opportunities = store
    .listOpportunities()
    .filter((o) => o.status === 'open' || o.status === 'proposed')
    .filter((o) => !store.coveredTopics().has(o.topic))
    .sort((a, b) => b.demandScore - a.demandScore)
    .slice(0, maxItems)

  const fans = store.listFans(0)
  const byId = new Map(fans.map((f) => [f.authorId, f]))

  const items: ContentBriefItem[] = opportunities.map((o) => ({
    topic: o.topic,
    topicLabel: o.topicLabel,
    demandScore: o.demandScore,
    repeatCount: o.repeatCount,
    videoCount: o.videoCount,
    unanswered: o.unanswered,
    askers: o.relatedAuthorIds
      .map((id) => byId.get(id)?.name)
      .filter((name): name is string => Boolean(name))
      .slice(0, 3),
    angle: angleFor(o.topicLabel, o.unanswered),
  }))

  const headline =
    items.length === 0
      ? 'No open opportunities right now — your audience is quiet this week.'
      : items.length === 1
        ? `${items[0]!.topicLabel} is the one thing your audience is asking for.`
        : `${items.length} things your audience is asking for — here is what to make next.`

  return {
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
    period: periodLabel(new Date()),
    headline,
    items,
  }
}
