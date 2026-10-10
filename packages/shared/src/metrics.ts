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

/**
 * The Formstep journey a viewer can take after a video, in order. Each one is
 * one PostHog event on Formstep's side (docs/plan.md, "What Formstep must
 * emit") or, for paid, a discount-code redemption.
 */
export const CONVERSION_KINDS = ['demo_started', 'signup', 'trial_started', 'paid'] as const
export type ConversionKind = (typeof CONVERSION_KINDS)[number]

export const CONVERSION_KIND_LABELS: Record<ConversionKind, string> = {
  demo_started: 'Demos',
  signup: 'Signups',
  trial_started: 'Trials',
  paid: 'Paid',
}

/** The one name of the money metric: on the report strip, in its table and on the episode page. */
export const VALUE_LABEL = 'Value'

/** How a conversion was tied to a persona: the tracked link's UTM (first touch) or a discount code. */
export const CONVERSION_VIAS = ['utm', 'code'] as const
export type ConversionVia = (typeof CONVERSION_VIAS)[number]

/** Discount codes the operator hands a persona are upper-case letters and digits, 3 to 24 long. */
export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9]{3,24}$/

export function normalizeDiscountCode(raw: string): string | null {
  const code = raw.trim().toUpperCase()
  return DISCOUNT_CODE_PATTERN.test(code) ? code : null
}
