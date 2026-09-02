import type { DigestItem, DecisionValue, Fan, Opportunity, Signal } from '@creatorsignal/shared'

export interface GatewayContext {
  opportunities: Opportunity[]
  fans: Fan[]
  coveredTopics: Set<string>
  minDemandScore: number
  superfanThreshold: number
}

export interface GatewayResult {
  opportunities: Opportunity[]
  fans: Fan[]
  digestItems: DigestItem[]
}

/**
 * The MindGateway is the seam between our backend and the Mind.
 *
 * In `simulated` mode the detection logic runs locally so the product works
 * end to end without a live Mind. In `telegram` mode the same protocol
 * envelopes are pushed to the real Mind over Telegram; in `builder` mode they
 * go over the Minds Builder API. In both real modes the Mind's replies arrive
 * asynchronously through the message handler.
 */
export interface MindGateway {
  readonly mode: 'simulated' | 'telegram' | 'builder'
  /** Feed new signals into the Mind. Returns whatever the Mind produced. */
  processSignals(signals: Signal[], ctx: GatewayContext): Promise<GatewayResult>
  /** Tell the Mind a creator decision so it updates its creator memory. */
  recordDecision(opportunity: Opportunity, decision: DecisionValue, note: string): Promise<void>
  /** Ask the Mind for a digest. In simulated mode items come back directly. */
  requestDigest(ctx: GatewayContext): Promise<DigestItem[]>
  /** Optional lifecycle hooks (telegram polling). */
  start?(): Promise<void>
  stop?(): Promise<void>
}
