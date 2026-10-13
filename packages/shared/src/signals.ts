export const SIGNAL_SOURCES = ['hackernews', 'reddit', 'google_trends', 'youtube_search', 'search', 'comments', 'problems'] as const
export type SignalSource = (typeof SIGNAL_SOURCES)[number]

export const SIGNAL_SOURCE_LABELS: Record<SignalSource, string> = {
  hackernews: 'Hacker News',
  reddit: 'Reddit',
  google_trends: 'Google Trends',
  youtube_search: 'YouTube search',
  search: 'Search suggestions',
  comments: 'Comments',
  problems: 'Problem log',
}

/**
 * The sources the researcher polls on its own. Comments arrive from the
 * publisher's comment poll and problems from the problem log, so neither is
 * fetched from outside.
 */
export const POLLED_SIGNAL_SOURCES = [
  'hackernews',
  'reddit',
  'google_trends',
  'youtube_search',
  'search',
] as const satisfies readonly SignalSource[]
export type PolledSignalSource = (typeof POLLED_SIGNAL_SOURCES)[number]

export const SIGNAL_STATUSES = ['new', 'used', 'dismissed'] as const
export type SignalStatus = (typeof SIGNAL_STATUSES)[number]

/** Signals nobody used age out after this long. */
export const SIGNAL_TTL_MS = 14 * 24 * 60 * 60 * 1000

/** A signal's freshness halves every this many days. */
export const FRESHNESS_HALF_LIFE_DAYS = 2

/** Below this freshness a signal is cold: an episode built on it gets swapped before its script is written. */
export const COLD_FRESHNESS = 25

/** A cold episode is swapped only for a signal at least this fresh; anything weaker is not worth the change. */
export const SWAP_MIN_FRESHNESS = 60

const DAY_MS = 86_400_000

/**
 * How much a signal still matters at `now`: its score, halved for every
 * FRESHNESS_HALF_LIFE_DAYS since it was published. A source that does not say
 * when an item was published is dated by when the researcher found it.
 */
export function signalFreshness(signal: { score: number; publishedAt?: number; foundAt: number }, now: number): number {
  const publishedAt = signal.publishedAt === undefined ? signal.foundAt : signal.publishedAt
  const ageDays = Math.max(0, now - publishedAt) / DAY_MS
  return Math.round(signal.score * 0.5 ** (ageDays / FRESHNESS_HALF_LIFE_DAYS))
}

export function isCold(freshness: number): boolean {
  return freshness < COLD_FRESHNESS
}
