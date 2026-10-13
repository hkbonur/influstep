import type { PolledSignalSource, SignalSource } from '@influstep/shared'
import { providersMode } from '../../lib/env'
import { hackerNewsSignals } from './hackernews'
import { mockSignals } from './mock'
import { redditSignals } from './reddit'
import { searchSuggestionSignals } from './search'
import type { SignalsProvider } from './types'

/**
 * Sources with a real adapter today. In real mode the researcher skips the
 * rest, and the Providers page says so. Search suggestions read Google's
 * unofficial autocomplete endpoint (search.ts); Google Trends has no adapter
 * yet.
 */
const REAL: Partial<Record<PolledSignalSource, SignalsProvider>> = {
  hackernews: hackerNewsSignals,
  reddit: redditSignals,
  search: searchSuggestionSignals,
}

export function signalsProvider(source: PolledSignalSource): SignalsProvider {
  if (providersMode() === 'mock') return mockSignals(source)
  const real = REAL[source]
  if (!real) throw new Error(`No real adapter for signal source "${source}" yet`)
  return real
}

export function signalSourceHasRealAdapter(source: SignalSource): boolean {
  return source in REAL
}

export type { FoundSignal } from './types'
