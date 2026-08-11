import type { DigestItem, DecisionValue, Fan, Opportunity, Signal } from '@creatorsignal/shared'
import type { GatewayContext, GatewayResult, MindGateway } from './gateway.js'
import { composeDigest, computeFans, detectOpportunities } from './detect.js'

export interface SimulatedMindOptions {
  /** Digest item limit used when composing digests. */
  maxDigestItems?: number
}

/**
 * A local stand-in for the real Mind, used for development, tests, and the
 * demo. It runs the exact detection, relationship, and digest logic that the
 * real Mind's skills will run, and it persists nothing of its own: the
 * backend store is its memory, mirroring how the real Mind keeps its memory
 * in its Soul.
 */
export class SimulatedMindGateway implements MindGateway {
  readonly mode = 'simulated' as const
  private readonly maxDigestItems: number

  constructor(options: SimulatedMindOptions = {}) {
    this.maxDigestItems = options.maxDigestItems ?? 5
  }

  async processSignals(signals: Signal[], ctx: GatewayContext): Promise<GatewayResult> {
    const detection = detectOpportunities(signals, ctx.opportunities, {
      minDemandScore: ctx.minDemandScore,
      coveredTopics: ctx.coveredTopics,
    })
    const opportunities = [...ctx.opportunities, ...detection.created]
    for (const updated of detection.updated) {
      const index = opportunities.findIndex((o) => o.id === updated.id)
      if (index >= 0) opportunities[index] = updated
    }
    const fans = computeFans(signals, { superfanThreshold: ctx.superfanThreshold })
    const digestItems = composeDigest(opportunities, fans, {
      newlyCreatedIds: detection.created.map((o) => o.id),
      maxItems: this.maxDigestItems,
    })
    return { opportunities, fans, digestItems }
  }

  async recordDecision(_opportunity: Opportunity, _decision: DecisionValue, _note: string): Promise<void> {
    // Status transitions are handled by the backend store; the simulated mind
    // has no separate state to update.
  }

  async requestDigest(ctx: GatewayContext): Promise<DigestItem[]> {
    return composeDigest(ctx.opportunities, ctx.fans, {
      newlyCreatedIds: [],
      maxItems: this.maxDigestItems,
    })
  }
}
