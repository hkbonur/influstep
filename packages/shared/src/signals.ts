export const SIGNAL_SOURCES = ['hackernews', 'reddit', 'google_trends', 'comments', 'youtube_search'] as const
export type SignalSource = (typeof SIGNAL_SOURCES)[number]

export const SIGNAL_SOURCE_LABELS: Record<SignalSource, string> = {
  hackernews: 'Hacker News',
  reddit: 'Reddit',
  google_trends: 'Google Trends',
  comments: 'Comments',
  youtube_search: 'YouTube search',
}

export const SIGNAL_STATUSES = ['new', 'used', 'dismissed'] as const
export type SignalStatus = (typeof SIGNAL_STATUSES)[number]

/** Signals nobody used age out after this long. */
export const SIGNAL_TTL_MS = 14 * 24 * 60 * 60 * 1000
