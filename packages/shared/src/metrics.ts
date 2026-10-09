export const METRIC_KEYS = ['views', 'watch_rate', 'follows', 'clicks', 'signups', 'paid'] as const
export type MetricKey = (typeof METRIC_KEYS)[number]

export const METRIC_LABELS: Record<MetricKey, string> = {
  views: 'Views',
  watch_rate: 'Watch rate',
  follows: 'Follows',
  clicks: 'Clicks',
  signups: 'Signups',
  paid: 'Paid',
}

/** DESIGN.md: fixed series colors so the operator learns them once. */
export const METRIC_SERIES: Record<MetricKey, string> = {
  views: 'var(--chart-2)',
  watch_rate: 'var(--chart-2)',
  follows: 'var(--chart-1)',
  clicks: 'var(--chart-3)',
  signups: 'var(--chart-4)',
  paid: 'var(--chart-5)',
}

/** How long after publishing the analyst keeps snapshotting before an episode is measured. */
export const MEASUREMENT_WINDOW_MS = 72 * 60 * 60 * 1000

export const CONVERSION_KINDS = ['signup', 'form_published', 'paid'] as const
export type ConversionKind = (typeof CONVERSION_KINDS)[number]
