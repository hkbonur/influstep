import type { MetricKey } from './metrics'

export const EXPERIMENT_KINDS = ['hook', 'concept', 'sponsor'] as const
export type ExperimentKind = (typeof EXPERIMENT_KINDS)[number]

export const EXPERIMENT_KIND_LABELS: Record<ExperimentKind, string> = {
  hook: 'Hook',
  concept: 'Concept',
  sponsor: 'Sponsor segment',
}

export const EXPERIMENT_STATUSES = ['running', 'decided', 'stopped'] as const
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number]

export interface VariantStats {
  key: string
  /** Episodes measured under this variant. */
  episodes: number
  /** Denominator of the metric: views for click rate, clicks for signup rate. */
  exposures: number
  /** Numerator of the metric. */
  successes: number
}

export interface ExperimentDecision {
  winnerKey: string
  /** Relative lift of the winner over the runner-up, 0.25 = 25% better. */
  lift: number
  /** One-sided confidence that the winner's rate is higher, 0..1. */
  confidence: number
}

/** What a metric is a rate of, so two variants compare like for like. */
export const METRIC_DENOMINATOR: Record<MetricKey, 'views' | 'clicks' | 'episodes'> = {
  views: 'episodes',
  watch_rate: 'views',
  follows: 'views',
  clicks: 'views',
  signups: 'clicks',
  paid: 'clicks',
}

function rate(stats: VariantStats): number {
  if (stats.exposures === 0) return 0
  return stats.successes / stats.exposures
}

/** Standard normal CDF, Abramowitz-Stegun 7.1.26. Good to 1.5e-7, enough for a verdict. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/**
 * Two-proportion z-test between the best and second-best variant. Returns a
 * decision only once every variant has `minExposures` and the confidence
 * clears `minConfidence`; otherwise the experiment keeps running.
 */
export function decideExperiment(
  variants: VariantStats[],
  options: { minExposures: number; minConfidence: number }
): ExperimentDecision | undefined {
  if (variants.length < 2) return undefined
  if (variants.some((variant) => variant.exposures < options.minExposures)) return undefined

  const ranked = [...variants].sort((a, b) => rate(b) - rate(a))
  const [best, second] = ranked
  if (!best || !second) return undefined

  const pooled = (best.successes + second.successes) / (best.exposures + second.exposures)
  if (pooled === 0 || pooled === 1) return undefined
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / best.exposures + 1 / second.exposures))
  const z = (rate(best) - rate(second)) / standardError
  const confidence = normalCdf(z)
  if (confidence < options.minConfidence) return undefined

  const secondRate = rate(second)
  const lift = secondRate === 0 ? 1 : rate(best) / secondRate - 1
  return { winnerKey: best.key, lift, confidence }
}

export function variantRate(stats: VariantStats): number {
  return rate(stats)
}
