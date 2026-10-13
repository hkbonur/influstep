import { LENGTH_SEC_MIN } from './formats'
import type { MetricKey } from './metrics'
import type { StrategyDefault } from './strategy'

/**
 * The dimensions an experiment can vary (docs/plan.md, v0.2 items 8 and 9),
 * each with its catalog of variants below. The X post dimensions (intent,
 * length, reply style) join in slice 11.
 */
export const EXPERIMENT_KINDS = ['hook', 'concept', 'sponsor', 'length', 'cta', 'publish_time', 'description_format'] as const
export type ExperimentKind = (typeof EXPERIMENT_KINDS)[number]

export const EXPERIMENT_KIND_LABELS: Record<ExperimentKind, string> = {
  hook: 'Hook style',
  concept: 'Concept angle',
  sponsor: 'Sponsor placement',
  length: 'Episode length',
  cta: 'Call to action',
  publish_time: 'Publish time',
  description_format: 'Description format',
}

/**
 * The dimensions the writer scripts. Publish time moves the publication's
 * hour and description format orders the description's footer; the script
 * reads the same under either, so the writer gets no line for them.
 */
export const SCRIPT_KINDS = ['hook', 'concept', 'sponsor', 'length', 'cta'] as const satisfies readonly ExperimentKind[]
export type ScriptKind = (typeof SCRIPT_KINDS)[number]

export function isScriptKind(kind: ExperimentKind): kind is ScriptKind {
  return SCRIPT_KINDS.some((entry) => entry === kind)
}

export const EXPERIMENT_STATUSES = ['running', 'decided', 'stopped'] as const
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number]

/**
 * One arm of an experiment, as the catalog lists it and as an experiment row
 * stores it. `description` is the instruction the writer follows. A length
 * variant scales the format's length by `lengthFactor`, and a publish time
 * variant moves the platform's usual hour by `hourOffset`; no other kind has
 * either.
 */
export interface CatalogVariant {
  key: string
  label: string
  description: string
  isControl: boolean
  lengthFactor?: number
  hourOffset?: number
}

/**
 * What the persona can test on each dimension. The first variant of each is
 * the control, what the persona did before it tested anything. Descriptions
 * read after "From now on I", so the chat can say what a decided winner
 * changes in the persona's own words.
 */
export const EXPERIMENT_CATALOG: Record<ExperimentKind, readonly CatalogVariant[]> = {
  hook: [
    { key: 'howto', label: 'How to', description: 'Open by saying what the viewer will be able to do.', isControl: true },
    { key: 'question', label: 'Question', description: 'Open with the question the viewer has.', isControl: false },
    // The seed's running experiment tests this key, so it stays.
    { key: 'wrong', label: 'Confession', description: 'Open by admitting a mistake I made and what it taught me.', isControl: false },
    { key: 'number', label: 'Number', description: 'Open with a count, like "3 things about …".', isControl: false },
    { key: 'result', label: 'Result first', description: 'Open with the result first, then show how.', isControl: false },
  ],
  concept: [
    { key: 'tutorial', label: 'Tutorial', description: 'Teach one thing, step by step.', isControl: true },
    { key: 'mistake', label: 'Mistake and fix', description: 'Build the episode around a mistake and its fix.', isControl: false },
    { key: 'comparison', label: 'Comparison', description: 'Show two ways or two tools side by side.', isControl: false },
    { key: 'story', label: 'Story', description: 'Tell a short story from a real workflow.', isControl: false },
  ],
  sponsor: [
    { key: 'end', label: 'After the point', description: 'Bring the sponsor up after the main point.', isControl: true },
    { key: 'early', label: 'Early', description: 'Bring the sponsor up in the first third.', isControl: false },
    {
      key: 'woven',
      label: 'Woven in',
      description: 'Show the sponsor as the tool that does the thing, not as an aside.',
      isControl: false,
    },
  ],
  length: [
    { key: 'standard', label: 'Standard', description: "Run the format's usual length.", isControl: true, lengthFactor: 1 },
    {
      key: 'shorter',
      label: 'Shorter',
      description: "Run 30% shorter than the format's usual length.",
      isControl: false,
      lengthFactor: 0.7,
    },
    { key: 'longer', label: 'Longer', description: "Run 30% longer than the format's usual length.", isControl: false, lengthFactor: 1.3 },
  ],
  cta: [
    { key: 'follow', label: 'Follow', description: 'End by asking the viewer to follow for the next one.', isControl: true },
    { key: 'comment', label: 'Comment', description: 'End with a question for the comments.', isControl: false },
    { key: 'link', label: 'Link', description: 'End by pointing at the link in the description.', isControl: false },
  ],
  publish_time: [
    { key: 'usual', label: 'Usual hour', description: "Publish at the platform's usual hour.", isControl: true, hourOffset: 0 },
    {
      key: 'earlier',
      label: 'Three hours earlier',
      description: "Publish three hours before the platform's usual hour.",
      isControl: false,
      hourOffset: -3,
    },
    {
      key: 'later',
      label: 'Three hours later',
      description: "Publish three hours after the platform's usual hour.",
      isControl: false,
      hourOffset: 3,
    },
  ],
  description_format: [
    {
      key: 'link',
      label: 'Link first',
      description: 'Put the tracked link first in the description, the code under it.',
      isControl: true,
    },
    {
      key: 'code',
      label: 'Code first',
      description: 'Put the discount code and its offer first in the description, the link under it.',
      isControl: false,
    },
  ],
}

/** The catalog's control of a dimension: its first variant. */
export function catalogControl(kind: ExperimentKind): CatalogVariant {
  const [control] = EXPERIMENT_CATALOG[kind]
  if (!control) throw new Error(`the experiment catalog has no variants for ${kind}`)
  return control
}

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
export const METRIC_DENOMINATOR = {
  views: 'episodes',
  watch_rate: 'views',
  follows: 'views',
  clicks: 'views',
  signups: 'clicks',
  paid: 'clicks',
} as const satisfies Record<MetricKey, 'views' | 'clicks' | 'episodes'>

export type MetricDenominator = (typeof METRIC_DENOMINATOR)[MetricKey]

/** A metric as the rate an experiment compares, for learnings and the journal: "clicks per view". */
export const METRIC_RATE_LABELS: Record<MetricKey, string> = {
  views: 'views per episode',
  watch_rate: 'watch rate',
  follows: 'follows per view',
  clicks: 'clicks per view',
  signups: 'signups per click',
  paid: 'paid per click',
}

/**
 * The metrics the persona can pick an experiment's goal from, the one closest
 * to the goal (paying Formstep customers) first. The plan's ladder ends on
 * views; `follows` stands in for it because the decision is a two-proportion
 * test, and views per episode is not a proportion while follows per view is.
 */
export const GOAL_METRICS = ['paid', 'signups', 'clicks', 'follows'] as const satisfies readonly MetricKey[]
export type GoalMetric = (typeof GOAL_METRICS)[number]

/** Exposures every variant of an experiment the persona picks needs before it can decide, by the metric's denominator. */
export const METRIC_MIN_EXPOSURES: Record<(typeof METRIC_DENOMINATOR)[GoalMetric], number> = {
  views: 2000,
  clicks: 100,
}

/** The confidence an experiment the persona picks needs before its leader becomes the default. */
export const AUTO_MIN_CONFIDENCE = 0.9

/**
 * A confidence as a whole percentage, rounded down and at most 99: a test is
 * never certain, so 0.9996 reads 99%, and so does a z-test whose p-value
 * underflows to a confidence of exactly 1.
 */
export function confidencePercent(confidence: number): number {
  return Math.min(99, Math.floor(confidence * 100))
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

/** How many successes a metric needs in the window before the persona aims an experiment at it. */
export const GOAL_MIN_SUCCESSES = 10

/**
 * The metric the persona's next experiment aims at: the first of the ladder
 * whose successes in the window reach `minSuccesses`, so an experiment never
 * waits months for a rate it cannot measure. Follows when none does.
 */
export function pickGoalMetric(window: Record<GoalMetric, number>, minSuccesses = GOAL_MIN_SUCCESSES): GoalMetric {
  return GOAL_METRICS.find((metric) => window[metric] >= minSuccesses) ?? 'follows'
}

/**
 * A finished experiment of the persona, as the next pick reads it: which
 * variants it ran and, once decided, which won and when. A stopped one taught
 * nothing, so it has neither.
 */
export type ExperimentHistoryRow = {
  id: string
  kind: ExperimentKind
  variants: readonly CatalogVariant[]
} & (
  | {
      status: 'decided'
      winnerKey: string
      decidedAt: number
      /**
       * The variant that came second, whose rate a contradiction compares
       * against. The analyst's decisions store it; the operator's verdict has
       * no ranking, and decisions from before it was stored lack it.
       */
      runnerUpKey?: string
    }
  | { status: 'stopped' }
)

/** The persona's next experiment: the dimension, what it does now (the control), and what it tries instead. */
export interface NextExperiment {
  kind: ExperimentKind
  control: CatalogVariant
  challenger: CatalogVariant
  /** The decided experiment whose winner later data contradicted, when this tests it again. */
  retestOf?: string
}

/** How far back a decision or a loss counts as knowledge: older ones are tried again. */
const EXPERIMENT_MEMORY_MS = 180 * 24 * 60 * 60 * 1000

type DecidedRow = Extract<ExperimentHistoryRow, { status: 'decided' }>

function decidedRows(history: readonly ExperimentHistoryRow[], kind: ExperimentKind): DecidedRow[] {
  return history.flatMap((row) => (row.kind === kind && row.status === 'decided' ? [row] : []))
}

/** A default as the control of a new experiment: what the persona did before. */
function asControl(variant: {
  key: string
  label: string
  description: string
  lengthFactor?: number
  hourOffset?: number
}): CatalogVariant {
  const control: CatalogVariant = { key: variant.key, label: variant.label, description: variant.description, isControl: true }
  if (variant.lengthFactor !== undefined) control.lengthFactor = variant.lengthFactor
  if (variant.hourOffset !== undefined) control.hourOffset = variant.hourOffset
  return control
}

function asChallenger(variant: CatalogVariant): CatalogVariant {
  return { ...variant, isControl: false }
}

/**
 * The variant a decided experiment's winner beat: the runner-up, whose rate a
 * contradiction compares against, so a re-test runs against the variant whose
 * number triggered it.
 */
function beatenVariant(row: DecidedRow): CatalogVariant {
  if (row.runnerUpKey !== undefined) {
    const runnerUp = row.runnerUpKey
    const beaten = row.variants.find((variant) => variant.key === runnerUp && variant.key !== row.winnerKey)
    if (!beaten) throw new Error(`experiment ${row.id} names runner-up "${runnerUp}", which is not one of its losing variants`)
    return beaten
  }
  // Decisions from before the runner-up's key was stored. An experiment the
  // persona picks has two variants, so the other one is the runner-up; with
  // more, the control when it lost, else the first variant that lost.
  const losers = row.variants.filter((variant) => variant.key !== row.winnerKey)
  const beaten = losers.find((variant) => variant.isControl) ?? losers[0]
  if (!beaten) throw new Error(`experiment ${row.id} was decided with no variant beside its winner`)
  return beaten
}

/**
 * The challenger on a dimension: a catalog variant other than what the
 * persona does now that has not lost there in the last 180 days, in catalog
 * order; when every one has, the one that lost longest ago.
 */
function pickChallenger(kind: ExperimentKind, currentKey: string, decided: DecidedRow[], now: number): CatalogVariant | null {
  const candidates = EXPERIMENT_CATALOG[kind].filter((variant) => variant.key !== currentKey)
  const lostAt = (key: string): number | null => {
    const losses = decided.filter((row) => row.winnerKey !== key && row.variants.some((variant) => variant.key === key))
    if (losses.length === 0) return null
    return Math.max(...losses.map((row) => row.decidedAt))
  }
  const fresh = candidates.find((variant) => {
    const lost = lostAt(variant.key)
    if (lost === null) return true
    return lost < now - EXPERIMENT_MEMORY_MS
  })
  if (fresh) return fresh
  let oldest: { variant: CatalogVariant; lostAt: number } | null = null
  for (const variant of candidates) {
    const lost = lostAt(variant.key)
    if (lost === null) continue
    if (oldest === null || lost < oldest.lostAt) oldest = { variant, lostAt: lost }
  }
  return oldest === null ? null : oldest.variant
}

/**
 * Which experiment the persona runs next (docs/plan.md, v0.2 item 8). A
 * dimension whose default later data contradicted comes first, tested again
 * against the variant it beat. Otherwise the dimension the persona knows least
 * about: the fewest decided experiments in the last 180 days, then the one
 * decided longest ago (never decided first), then catalog order. Null when no
 * dimension applies to the persona.
 */
export function pickNextExperiment(args: {
  /** The dimensions that apply to the persona now. */
  kinds: readonly ExperimentKind[]
  /** The persona's decided and stopped experiments, of any age. */
  history: readonly ExperimentHistoryRow[]
  defaults: readonly StrategyDefault[]
  /** Dimensions whose default later data contradicted. */
  contradicted: readonly ExperimentKind[]
  now: number
}): NextExperiment | null {
  const applicable = EXPERIMENT_KINDS.filter((kind) => args.kinds.includes(kind))
  for (const kind of applicable) {
    if (!args.contradicted.includes(kind)) continue
    const current = args.defaults.find((entry) => entry.kind === kind)
    if (current?.experimentId === undefined) throw new Error(`the ${kind} default is contradicted but came from no experiment`)
    const source = decidedRows(args.history, kind).find((row) => row.id === current.experimentId)
    if (!source)
      throw new Error(`the ${kind} default came from experiment ${current.experimentId}, which is not a decided ${kind} experiment`)
    return { kind, control: asControl(current), challenger: asChallenger(beatenVariant(source)), retestOf: source.id }
  }

  const ranked = applicable
    .map((kind, order) => {
      const decided = decidedRows(args.history, kind)
      const recent = decided.filter((row) => row.decidedAt >= args.now - EXPERIMENT_MEMORY_MS).length
      const lastDecidedAt = decided.length === 0 ? null : Math.max(...decided.map((row) => row.decidedAt))
      return { kind, order, recent, lastDecidedAt, decided }
    })
    .sort((a, b) => {
      if (a.recent !== b.recent) return a.recent - b.recent
      if (a.lastDecidedAt !== b.lastDecidedAt) {
        if (a.lastDecidedAt === null) return -1
        if (b.lastDecidedAt === null) return 1
        return a.lastDecidedAt - b.lastDecidedAt
      }
      return a.order - b.order
    })
  for (const candidate of ranked) {
    const current = args.defaults.find((entry) => entry.kind === candidate.kind) ?? catalogControl(candidate.kind)
    const challenger = pickChallenger(candidate.kind, current.key, candidate.decided, args.now)
    if (!challenger) continue
    return { kind: candidate.kind, control: asControl(current), challenger: asChallenger(challenger) }
  }
  return null
}

/**
 * The exposures a default needs since its decision before later data can
 * contradict it: the metric's own minimum (METRIC_MIN_EXPOSURES), whatever
 * the experiment asked for, so an operator's quick experiment is not
 * re-tested on noise. Views per episode counts episodes, which have no such
 * minimum, so it keeps the experiment's own.
 */
export function contradictionMinExposures(metric: MetricKey, experimentMinExposures: number): number {
  const denominator = METRIC_DENOMINATOR[metric]
  if (denominator === 'episodes') return experimentMinExposures
  return METRIC_MIN_EXPOSURES[denominator]
}

/**
 * Whether later data contradicts a decided winner: once the default has
 * `minExposures` since the decision (`contradictionMinExposures`), its rate
 * since then is at or below what the runner-up had at the decision.
 */
export function contradicts(decision: { winnerRate: number; runnerUpRate: number }, since: VariantStats, minExposures: number): boolean {
  if (since.exposures < minExposures) return false
  return rate(since) <= decision.runnerUpRate
}

export interface PillarWeight {
  pillar: string
  weight: number
}

/**
 * The weights the planner shares the evergreen slots out by, one per current
 * pillar in pillar order, summing to 1. A stored weight of a current pillar is
 * kept, a pillar without one gets the mean of the others (equal shares when
 * none is stored), and a removed pillar's weight is dropped. The one reading
 * of the stored list: nothing reads it raw.
 */
export function pillarWeights(pillars: readonly string[], stored: readonly PillarWeight[] | undefined): PillarWeight[] {
  if (pillars.length === 0) return []
  const kept = pillars.map((pillar) => ({ pillar, weight: stored?.find((entry) => entry.pillar === pillar)?.weight }))
  const known = kept.flatMap((entry) => (entry.weight === undefined ? [] : [entry.weight]))
  const fill = known.length === 0 ? 1 : known.reduce((sum, weight) => sum + weight, 0) / known.length
  const filled = kept.map((entry) => ({ pillar: entry.pillar, weight: entry.weight ?? fill }))
  const total = filled.reduce((sum, entry) => sum + entry.weight, 0)
  if (total <= 0) throw new Error('stored pillar weights sum to zero; the review never stores a weight under the floor')
  return filled.map((entry) => ({ pillar: entry.pillar, weight: entry.weight / total }))
}

/** What one review moves from the weakest pillar to the strongest, and the least a pillar keeps. */
const PILLAR_WEIGHT_STEP = 0.1
const PILLAR_WEIGHT_FLOOR = 0.1
/** How far ahead the strongest pillar must be, on its score or on the tiebreak, before weight moves. */
const PILLAR_LEAD = 1.2
/** A pillar needs this many measured episodes before its score counts. */
const PILLAR_MIN_EPISODES = 2

export interface PillarScore {
  pillar: string
  /** Value per episode. */
  score: number
  /** Clicks per view, for pillars that tie on value. */
  tiebreak: number
  episodes: number
}

/** True when `best` is at least PILLAR_LEAD times `worst` and strictly above it. */
function leads(best: number, worst: number): boolean {
  if (best <= worst) return false
  return best >= worst * PILLAR_LEAD
}

/**
 * One review's change to the pillar weights: among pillars with at least two
 * measured episodes, when the best scores at least 20% above the worst (or
 * ties on score and wins the tiebreak by 20%), 0.1 moves from the worst to the
 * best, never taking a pillar under 0.1. Null when nothing moves.
 */
export function shiftPillarWeights(
  weights: readonly PillarWeight[],
  scores: readonly PillarScore[]
): { weights: PillarWeight[]; change: { up: string; down: string } } | null {
  const order = (pillar: string) => weights.findIndex((entry) => entry.pillar === pillar)
  const measured = scores
    .filter((score) => {
      if (score.episodes < PILLAR_MIN_EPISODES) return false
      return order(score.pillar) !== -1
    })
    .sort((a, b) => b.score - a.score || b.tiebreak - a.tiebreak || order(a.pillar) - order(b.pillar))
  const best = measured[0]
  const worst = measured[measured.length - 1]
  if (!best || !worst || best.pillar === worst.pillar) return null
  const ahead = best.score === worst.score ? leads(best.tiebreak, worst.tiebreak) : leads(best.score, worst.score)
  if (!ahead) return null
  const worstEntry = weights.find((entry) => entry.pillar === worst.pillar)
  if (!worstEntry) throw new Error(`pillar "${worst.pillar}" was scored but has no weight`)
  const moved = Math.min(PILLAR_WEIGHT_STEP, worstEntry.weight - PILLAR_WEIGHT_FLOOR)
  // Floating point leaves a pillar at the floor a hair above it; that is no room to move.
  if (moved < 1e-9) return null
  const shifted = weights.map((entry) => {
    if (entry.pillar === best.pillar) return { pillar: entry.pillar, weight: entry.weight + moved }
    if (entry.pillar === worst.pillar) return { pillar: entry.pillar, weight: entry.weight - moved }
    return { pillar: entry.pillar, weight: entry.weight }
  })
  const total = shifted.reduce((sum, entry) => sum + entry.weight, 0)
  return {
    weights: shifted.map((entry) => ({ pillar: entry.pillar, weight: entry.weight / total })),
    change: { up: best.pillar, down: worst.pillar },
  }
}

/**
 * The pillars of a week's evergreen slots, in slot order: each slot goes to
 * the pillar with the largest `weight * (total + 1) - count`, where total is
 * every prior episode plus the slots assigned so far and count is the
 * pillar's. Prior episodes count, so the weights hold across weeks. Ties go
 * to the pillar listed first. Only the weighted pillars' counts make the
 * total: an episode of a removed pillar says nothing about the current ones.
 */
export function allocatePillars(weights: readonly PillarWeight[], priorCounts: Readonly<Record<string, number>>, slots: number): string[] {
  if (slots <= 0) return []
  if (weights.length === 0) throw new Error('allocating pillars needs at least one weighted pillar')
  const rows = weights.map((entry) => ({ pillar: entry.pillar, weight: entry.weight, count: priorCounts[entry.pillar] ?? 0 }))
  let total = rows.reduce((sum, row) => sum + row.count, 0)
  const out: string[] = []
  for (let slot = 0; slot < slots; slot += 1) {
    let pick: { row: (typeof rows)[number]; need: number } | null = null
    for (const row of rows) {
      const need = row.weight * (total + 1) - row.count
      // Weights that are equal on paper differ in the last bits; treat them as tied, so the first listed wins.
      if (pick === null || need > pick.need + 1e-9) pick = { row, need }
    }
    if (pick === null) throw new Error('pillar allocation picked no pillar')
    out.push(pick.row.pillar)
    pick.row.count += 1
    total += 1
  }
  return out
}

/** Measured publications an hour needs before its median counts. */
const HOUR_MIN_PUBLICATIONS = 3
/** How many hours must have enough publications before any comparison. */
const HOUR_MIN_HOURS = 2
/** How far the best hour's median must be above the current hour's. */
const HOUR_LEAD = 1.2

export interface HourViews {
  hour: number
  publications: number
  medianViews: number
}

/**
 * The publish hour a platform moves to, or null to keep it. Only hours with at
 * least three measured publications count, at least two such hours must
 * exist, and the best must have a median at least 20% above the current
 * hour's. The current hour needs its three publications too: without them
 * there is nothing to be 20% above.
 */
export function bestPublishHour(current: number, byHour: readonly HourViews[]): number | null {
  const counted = byHour.filter((row) => row.publications >= HOUR_MIN_PUBLICATIONS)
  if (counted.length < HOUR_MIN_HOURS) return null
  const now = counted.find((row) => row.hour === current)
  if (!now) return null
  const [best] = [...counted].sort((a, b) => b.medianViews - a.medianViews || a.hour - b.hour)
  if (!best || best.hour === current) return null
  if (best.medianViews <= now.medianViews) return null
  if (best.medianViews < now.medianViews * HOUR_LEAD) return null
  return best.hour
}

/**
 * The spoken length an episode is written to under a length variant: the
 * format's length times the variant's factor, rounded, never under the
 * shortest format. Any other variant, or none, keeps the length.
 */
export function variantLength(lengthSec: number, variant: { lengthFactor?: number } | undefined): number {
  const factor = variant?.lengthFactor ?? 1
  return Math.max(LENGTH_SEC_MIN, Math.round(lengthSec * factor))
}
