import type { SignalSource } from '@influstep/shared'

export interface FoundSignal {
  source: SignalSource
  externalId: string
  title: string
  url: string
  summary: string
  score: number
  topics: string[]
}

export interface SignalsQuery {
  /** Search terms, from the persona's pillars and niche. */
  terms: string[]
  /** Ignore anything older than this. */
  since: number
  limit: number
}

export interface SignalsProvider {
  readonly source: SignalSource
  readonly name: string
  find(query: SignalsQuery): Promise<FoundSignal[]>
}
