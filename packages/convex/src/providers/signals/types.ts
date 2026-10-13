import type { PolledSignalSource, SignalSource } from '@influstep/shared'

export interface FoundSignal {
  source: SignalSource
  externalId: string
  title: string
  url: string
  summary: string
  score: number
  topics: string[]
  /**
   * When the source says the item was posted, in ms. Freshness decays from
   * it (shared `signalFreshness`); without it, from when it was found.
   */
  publishedAt?: number
}

export interface SignalsQuery {
  /** Search terms, from the persona's pillars and niche. */
  terms: string[]
  /** Ignore anything older than this. */
  since: number
  limit: number
}

export interface SignalsProvider {
  readonly source: PolledSignalSource
  readonly name: string
  find(query: SignalsQuery): Promise<FoundSignal[]>
}
