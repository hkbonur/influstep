import type { SignalSource } from '@influstep/shared'
import { providersMode } from '../../lib/env'
import { hackerNewsSignals } from './hackernews'
import { mockSignals } from './mock'
import { redditSignals } from './reddit'
import type { SignalsProvider } from './types'

/** Sources with a real adapter today. The rest run mock even in real mode and say so on the Providers page. */
const REAL: Partial<Record<SignalSource, SignalsProvider>> = {
  hackernews: hackerNewsSignals,
  reddit: redditSignals,
}

export function signalsProvider(source: SignalSource): SignalsProvider {
  if (providersMode() === 'mock') return mockSignals(source)
  const real = REAL[source]
  if (!real) throw new Error(`No real adapter for signal source "${source}" yet`)
  return real
}

export function signalSourceHasRealAdapter(source: SignalSource): boolean {
  return source in REAL
}

export type { FoundSignal } from './types'
