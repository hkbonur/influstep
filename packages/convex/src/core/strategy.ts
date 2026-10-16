import {
  AUTO_MIN_CONFIDENCE,
  EXPERIMENT_KINDS,
  EXPERIMENT_KIND_LABELS,
  EXPERIMENT_SUBJECT,
  EXPERIMENT_SUBJECT_NOUNS,
  GOAL_MIN_SUCCESSES,
  METRIC_DENOMINATOR,
  METRIC_MIN_EXPOSURES,
  METRIC_RATE_LABELS,
  PLATFORM_LABELS,
  bestPublishHour,
  contradictionMinExposures,
  contradicts,
  pickGoalMetric,
  pickNextExperiment,
  pillarWeights,
  shiftPillarWeights,
  variantRate,
  workspaceGoal,
  type CatalogVariant,
  type ExperimentHistoryRow,
  type ExperimentKind,
  type GoalMetric,
  type HourViews,
  type NextExperiment,
  type PillarScore,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { dayKey, hourAt, hourText } from './dates'
import { dimensionProblem, grouped, rateNumber, rateText, startExperiment, variantStatsSince } from './experiments'
import { activeEntries, supersedeOthers } from './memory'
import { WHAT_WORKS_DAYS, latestPerPublication, measuredVideosSince, rankGroups, videoOutcomes } from './report'
import { workspaceOf } from './workspace'

/**
 * The weekly strategy review (docs/plan.md, v0.2 item 8). Every rule it
 * applies is deterministic: the pure rules live in shared experiments.ts,
 * and this file reads the persona's numbers for them and writes what they
 * decide, each change with a journal entry that says why.
 */

type Reader = { db: QueryCtx['db'] }
type Strategy = NonNullable<Doc<'personas'>['strategy']>

const DAY_MS = 24 * 60 * 60 * 1000
/** Measured episodes of this many days score the pillars: the report's "what works" window. */
const PILLAR_WINDOW_DAYS = WHAT_WORKS_DAYS
/** Measured publications of this many days compare the publish hours. */
const HOUR_WINDOW_DAYS = 56
/** Successes of this many days pick the next experiment's goal metric. */
const GOAL_WINDOW_DAYS = 28
/** How far back a decided experiment counts toward what the persona knows about a dimension; shared pickNextExperiment's window. */
const DECISION_MEMORY_DAYS = 180
/** The newest journal entries the strategy page shows. */
const JOURNAL_PAGE = 200
/** Paid conversions of this many days, against the same span before it, say where a persona stands against the goal. */
const STANDING_WINDOW_DAYS = 28

export interface ReviewOutcome {
  /** Changes made, one journal entry each. */
  changes: number
  startedExperimentId?: Id<'experiments'>
  /** The goal note this review left (every review leaves one). */
  goalNoteId: Id<'memories'>
}

/**
 * A change the review made, as a learning in the persona's memory: what the
 * numbers showed and what the persona does since. `key` names the subject; a
 * newer learning on it supersedes the older one, so the writer reads only
 * what the persona believes now.
 */
async function writeLearning(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  args: { text: string; key: string; episodeIds: Id<'episodes'>[]; now: number }
): Promise<void> {
  const learningId = await ctx.db.insert('memories', {
    personaId: persona._id,
    kind: 'learning',
    text: args.text,
    actor: 'analyst',
    evidence: { episodeIds: [...new Set(args.episodeIds)], signalIds: [] },
    key: args.key,
    status: 'active',
    createdAt: args.now,
  })
  await supersedeOthers(ctx, { _id: learningId, personaId: persona._id, kind: 'learning' }, (older) => older.key === args.key)
}

/** One change of the review: the journal entry is written; the phrase goes into the one chat message. */
interface Change {
  phrase: string
}

function percent(weight: number): number {
  return Math.round(weight * 100)
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]
  if (upper === undefined) throw new Error('the median of no values')
  if (sorted.length % 2 === 1) return upper
  const lower = sorted[middle - 1]
  if (lower === undefined) throw new Error('the median of no values')
  return (lower + upper) / 2
}

function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function withoutPeriod(text: string): string {
  return text.trim().replace(/[.!?]$/, '')
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/**
 * The pillar weights step: each pillar's value per measured video of the last
 * 28 days (paid conversions of its episodes, by link or by code, times the
 * workspace's value per paid), with clicks per view to break a tie, then
 * shared `shiftPillarWeights`. The scores are the report's "what works" by
 * pillar for this persona alone (core/report.ts `rankGroups`), so the
 * operator reads the numbers the review acts on.
 */
async function reviewPillars(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  strategy: Strategy,
  episodes: Doc<'episodes'>[],
  conversions: Doc<'conversions'>[],
  now: number
): Promise<{ strategy: Strategy; change: Change } | null> {
  const workspace = await workspaceOf(ctx, persona)
  const outcomes = await videoOutcomes(
    ctx,
    measuredVideosSince(episodes, now - PILLAR_WINDOW_DAYS * DAY_MS),
    conversions,
    workspace.valuePerPaid
  )
  const groups = rankGroups(outcomes, (episode) =>
    episode.pillar !== undefined && persona.pillars.includes(episode.pillar) ? { key: episode.pillar, label: episode.pillar } : null
  )
  const scores: (PillarScore & { episodeIds: Id<'episodes'>[]; views: number; clicks: number })[] = groups.map((group) => ({
    pillar: group.key,
    score: group.valuePerVideo,
    tiebreak: group.clicksPerView,
    episodes: group.videos,
    episodeIds: group.episodeIds,
    views: group.views,
    clicks: group.clicks,
  }))
  const before = pillarWeights(persona.pillars, strategy.pillarWeights)
  const shift = shiftPillarWeights(before, scores)
  if (!shift) return null
  const { up, down } = shift.change
  const upScore = scores.find((score) => score.pillar === up)
  const downScore = scores.find((score) => score.pillar === down)
  if (!upScore || !downScore) throw new Error(`the pillar shift moved between "${up}" and "${down}" without both scores`)
  const weightOf = (weights: readonly { pillar: string; weight: number }[], pillar: string) => {
    const entry = weights.find((candidate) => candidate.pillar === pillar)
    if (!entry) throw new Error(`pillar "${pillar}" has no weight`)
    return entry.weight
  }
  const money = (value: number) => `${grouped(value)} ${workspace.currency}`
  const clickRate = (score: { clicks: number; views: number }) => (score.views === 0 ? 0 : score.clicks / score.views)
  const onValue =
    `Over the last ${PILLAR_WINDOW_DAYS} days "${up}" made ${money(upScore.score)} per measured video over ${upScore.episodes} videos, ` +
    `and "${down}" ${money(downScore.score)} over ${downScore.episodes}.`
  const onClicks =
    `Over the last ${PILLAR_WINDOW_DAYS} days "${up}" and "${down}" made the same value per measured video, ` +
    `and "${up}" got ${rateText('clicks', clickRate(upScore))} clicks per view against ${rateText('clicks', clickRate(downScore))}.`
  const reason = upScore.score === downScore.score ? onClicks : onValue
  await ctx.db.insert('journal', {
    personaId: persona._id,
    kind: 'pillar_weights',
    actor: 'analyst',
    text:
      `"${up}" gets ${percent(weightOf(shift.weights, up))}% of the evergreen plan, up from ${percent(weightOf(before, up))}%, ` +
      `and "${down}" ${percent(weightOf(shift.weights, down))}%, down from ${percent(weightOf(before, down))}%.`,
    reason,
    evidence: {
      episodeIds: [...upScore.episodeIds, ...downScore.episodeIds],
      signalIds: [],
      numbers: [
        { label: `"${up}" value per video (${workspace.currency})`, value: Math.round(upScore.score) },
        { label: `"${down}" value per video (${workspace.currency})`, value: Math.round(downScore.score) },
        { label: `"${up}" clicks per view (%)`, value: rateNumber('clicks', clickRate(upScore)) },
        { label: `"${down}" clicks per view (%)`, value: rateNumber('clicks', clickRate(downScore)) },
        { label: `"${up}" weight (%)`, value: percent(weightOf(shift.weights, up)) },
        { label: `"${down}" weight (%)`, value: percent(weightOf(shift.weights, down)) },
      ],
    },
    createdAt: now,
  })
  await writeLearning(ctx, persona, {
    text:
      `${reason} So "${up}" gets ${percent(weightOf(shift.weights, up))}% of the evergreen plan ` +
      `and "${down}" ${percent(weightOf(shift.weights, down))}%.`,
    key: 'pillars',
    episodeIds: [...upScore.episodeIds, ...downScore.episodeIds],
    now,
  })
  return {
    strategy: { ...strategy, pillarWeights: shift.weights },
    change: { phrase: `gave "${up}" more of the plan and "${down}" less` },
  }
}

/**
 * The publish hours step, per platform except X, whose hours are post slots
 * (slice 11): the live publications of measured videos of the last 56 days,
 * grouped by their local publish hour, at the latest snapshot of each, then
 * shared `bestPublishHour`. A publication without a snapshot was not measured
 * on its platform yet and says nothing about its hour.
 */
async function reviewPublishHours(ctx: MutationCtx, persona: Doc<'personas'>, episodes: Doc<'episodes'>[], now: number): Promise<Change[]> {
  const measured = new Set(episodes.filter((episode) => episode.status === 'measured').map((episode) => episode._id))
  const publications = await ctx.db
    .query('publications')
    .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
    .collect()
  const since = now - HOUR_WINDOW_DAYS * DAY_MS
  let formats = persona.formats
  const changes: Change[] = []
  for (const format of persona.formats) {
    if (format.platform === 'x') continue
    const byHour = new Map<number, { views: number[]; episodeIds: Id<'episodes'>[] }>()
    for (const publication of publications) {
      if (publication.platform !== format.platform || publication.status !== 'live') continue
      if (publication.publishedAt === undefined || publication.publishedAt < since || !measured.has(publication.episodeId)) continue
      const [latest] = latestPerPublication(
        await ctx.db
          .query('metricSnapshots')
          .withIndex('by_publication', (q) => q.eq('publicationId', publication._id))
          .collect()
      )
      if (!latest) continue
      const hour = hourAt(publication.publishedAt, persona.timezone)
      const group = byHour.get(hour) ?? { views: [], episodeIds: [] }
      group.views.push(latest.counts.views)
      group.episodeIds.push(publication.episodeId)
      byHour.set(hour, group)
    }
    const rows: HourViews[] = [...byHour.entries()].map(([hour, group]) => ({
      hour,
      publications: group.views.length,
      medianViews: median(group.views),
    }))
    const best = bestPublishHour(format.publishHour, rows)
    if (best === null) continue
    const bestRow = rows.find((row) => row.hour === best)
    const currentRow = rows.find((row) => row.hour === format.publishHour)
    const bestGroup = byHour.get(best)
    const currentGroup = byHour.get(format.publishHour)
    if (!bestRow || !currentRow || !bestGroup || !currentGroup) throw new Error(`bestPublishHour picked ${best} without both hours counted`)
    formats = formats.map((candidate) => (candidate.platform === format.platform ? { ...candidate, publishHour: best } : candidate))
    await ctx.db.patch(persona._id, { formats })
    const label = PLATFORM_LABELS[format.platform]
    await ctx.db.insert('journal', {
      personaId: persona._id,
      kind: 'publish_hour',
      actor: 'analyst',
      text: `${label} videos go out at ${hourText(best)} now, not ${hourText(format.publishHour)}.`,
      reason:
        `Over the last ${HOUR_WINDOW_DAYS} days ${bestRow.publications} ${label} videos published at ${hourText(best)} had a median of ` +
        `${grouped(bestRow.medianViews)} views, against ${grouped(currentRow.medianViews)} for ${currentRow.publications} at ` +
        `${hourText(format.publishHour)}. Publications already scheduled keep their time.`,
      evidence: {
        episodeIds: [...bestGroup.episodeIds, ...currentGroup.episodeIds],
        signalIds: [],
        numbers: [
          { label: `Median views at ${hourText(best)}`, value: Math.round(bestRow.medianViews) },
          { label: `Median views at ${hourText(format.publishHour)}`, value: Math.round(currentRow.medianViews) },
          { label: `Videos at ${hourText(best)}`, value: bestRow.publications },
          { label: `Videos at ${hourText(format.publishHour)}`, value: currentRow.publications },
        ],
      },
      createdAt: now,
    })
    await writeLearning(ctx, persona, {
      text:
        `On ${label}, videos published at ${hourText(best)} had a median of ${grouped(bestRow.medianViews)} views over the last ` +
        `${HOUR_WINDOW_DAYS} days, against ${grouped(currentRow.medianViews)} at ${hourText(format.publishHour)}, ` +
        `so ${label} videos go out at ${hourText(best)} now.`,
      key: `publish_hour:${format.platform}`,
      episodeIds: [...bestGroup.episodeIds, ...currentGroup.episodeIds],
      now,
    })
    changes.push({ phrase: `moved ${label} to ${hourText(best)}` })
  }
  return changes
}

/** A default whose numbers since its decision fell to what the variant it beat had then. */
interface Contradiction {
  kind: ExperimentKind
  source: Doc<'experiments'>
  winnerRate: number
  runnerUpRate: number
  since: { rate: number; exposures: number }
}

/**
 * The contradictions step: every default that came from a decision with the
 * two rates it was decided on, measured since it became the default (core
 * `variantStatsSince`) until it has the metric's minimum exposures (shared
 * `contradictionMinExposures`). The operator's own verdict has no rates and is
 * never contradicted by numbers.
 */
async function findContradictions(
  ctx: Reader,
  persona: Doc<'personas'>,
  strategy: Strategy,
  experiments: Doc<'experiments'>[]
): Promise<Contradiction[]> {
  const out: Contradiction[] = []
  for (const entry of strategy.defaults) {
    if (entry.experimentId === undefined) continue
    // A decided publish time moves the formats' hours and stores no default; were one ever here, the re-test
    // branch of shared `pickNextExperiment` would look for a default the hours replaced.
    if (entry.kind === 'publish_time') continue
    const source = experiments.find((experiment) => experiment._id === entry.experimentId)
    if (!source) throw new Error(`the ${entry.kind} default came from experiment ${entry.experimentId}, which the persona does not have`)
    const decision = source.decision
    if (!decision) throw new Error(`the ${entry.kind} default came from experiment ${source._id}, which has no decision`)
    if (decision.winnerRate === undefined || decision.runnerUpRate === undefined) continue
    const since = await variantStatsSince(ctx, persona, entry.kind, entry.key, entry.since, source.metric)
    const rates = { winnerRate: decision.winnerRate, runnerUpRate: decision.runnerUpRate }
    if (!contradicts(rates, since, contradictionMinExposures(source.metric, source.minExposures))) continue
    out.push({ kind: entry.kind, source, ...rates, since: { rate: variantRate(since), exposures: since.exposures } })
  }
  return out
}

/**
 * The goal metric's window: successes of the last 28 days. Paid and signups
 * count only link-attributed conversions and follows only publications'
 * snapshots, the same successes an experiment on that metric would count.
 */
async function goalWindow(
  ctx: Reader,
  persona: Doc<'personas'>,
  conversions: Doc<'conversions'>[],
  now: number
): Promise<Record<GoalMetric, number>> {
  const since = now - GOAL_WINDOW_DAYS * DAY_MS
  const recent = conversions.filter((conversion) => conversion.via === 'utm' && conversion.at >= since)
  const clicks = await ctx.db
    .query('linkClicks')
    .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id).gte('at', since))
    .collect()
  const snapshots = await ctx.db
    .query('metricSnapshots')
    .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id).gte('takenAt', since))
    .collect()
  const follows = latestPerPublication(snapshots.filter((snapshot) => snapshot.publicationId !== undefined)).reduce(
    (sum, snapshot) => sum + snapshot.counts.follows,
    0
  )
  return {
    paid: recent.filter((conversion) => conversion.kind === 'paid').length,
    signups: recent.filter((conversion) => conversion.kind === 'signup').length,
    clicks: clicks.length,
    follows,
  }
}

const GOAL_NOUNS: Record<GoalMetric, string> = { paid: 'paid conversions', signups: 'signups', clicks: 'clicks', follows: 'follows' }

function historyOf(experiments: Doc<'experiments'>[]): ExperimentHistoryRow[] {
  return experiments.flatMap((experiment): ExperimentHistoryRow[] => {
    if (experiment.status === 'running') return []
    const base = { id: experiment._id, kind: experiment.kind, variants: experiment.variants }
    if (experiment.status === 'stopped') return [{ ...base, status: 'stopped' }]
    const decision = experiment.decision
    if (!decision) throw new Error(`experiment ${experiment._id} is decided without a decision`)
    return [
      {
        ...base,
        status: 'decided',
        winnerKey: decision.winnerKey,
        decidedAt: decision.decidedAt,
        // Absent on the operator's verdicts and on decisions from before it was stored (shared `beatenVariant`).
        ...(decision.runnerUpKey === undefined ? {} : { runnerUpKey: decision.runnerUpKey }),
      },
    ]
  })
}

function hypothesisOf(next: NextExperiment, metric: GoalMetric): string {
  const describe = (variant: CatalogVariant) => `"${variant.label}" (${lowerFirst(withoutPeriod(variant.description))})`
  return `${describe(next.challenger)} gets more ${METRIC_RATE_LABELS[metric]} than ${describe(next.control)}.`
}

/** Why the review starts what it starts: the dimension, and the goal metric. */
function startReason(args: {
  next: NextExperiment
  metric: GoalMetric
  window: Record<GoalMetric, number>
  history: ExperimentHistoryRow[]
  contradiction: Contradiction | undefined
  timezone: string
  now: number
}): string {
  const { next, metric } = args
  const dimension = EXPERIMENT_KIND_LABELS[next.kind]
  const subject = EXPERIMENT_SUBJECT[next.kind]
  const goal =
    subject !== 'video'
      ? `It aims at ${METRIC_RATE_LABELS[metric]}: ${EXPERIMENT_SUBJECT_NOUNS[subject].other} on X carry no link, so follows are the step closest to paying customers they move.`
      : args.window[metric] >= GOAL_MIN_SUCCESSES
        ? `It aims at ${METRIC_RATE_LABELS[metric]}: ${grouped(args.window[metric])} ${GOAL_NOUNS[metric]} in the last ${GOAL_WINDOW_DAYS} days, the step closest to paying customers with at least ${GOAL_MIN_SUCCESSES}.`
        : `It aims at ${METRIC_RATE_LABELS[metric]}: no step closer to paying customers had ${GOAL_MIN_SUCCESSES} successes in the last ${GOAL_WINDOW_DAYS} days.`
  if (args.contradiction) {
    const { source, winnerRate, runnerUpRate, since } = args.contradiction
    return (
      `"${next.control.label}" became the ${dimension.toLowerCase()} default by beating "${next.challenger.label}" ` +
      `${rateText(source.metric, winnerRate)} to ${rateText(source.metric, runnerUpRate)} on ${METRIC_RATE_LABELS[source.metric]}. ` +
      `Since then it got ${rateText(source.metric, since.rate)} over ${grouped(since.exposures)} ${METRIC_DENOMINATOR[source.metric]}, ` +
      `no better than "${next.challenger.label}" had, so the two are tested again. ${goal}`
    )
  }
  const decided = args.history.flatMap((row) => (row.kind === next.kind && row.status === 'decided' ? [row] : []))
  const recent = decided.filter((row) => row.decidedAt >= args.now - DECISION_MEMORY_DAYS * DAY_MS)
  const last = decided.reduce<number | null>((latest, row) => (latest === null || row.decidedAt > latest ? row.decidedAt : latest), null)
  const known =
    last === null
      ? `${dimension} was never tested.`
      : recent.length === 0
        ? `${dimension} was last decided on ${dayKey(last, args.timezone)}, more than ${DECISION_MEMORY_DAYS} days ago.`
        : `${dimension} has the fewest decided experiments of the last ${DECISION_MEMORY_DAYS} days, the last on ${dayKey(last, args.timezone)}.`
  return `${known} ${goal}`
}

/**
 * The next experiment step: only when none is running. Every dimension
 * applies, except a video dimension for a persona that posts only on X, the
 * sponsor placement before the persona carries a sponsor (a zero dial, or
 * still within the ramp), and any dimension core experiments
 * `dimensionProblem` says would compare nothing: the description format
 * without a discount code in force, the post kind without both text and image
 * posts, and the reply dimensions for a persona that answers nobody. A video
 * experiment aims at the goal metric of the window (shared `pickGoalMetric`);
 * a post or reply experiment at follows, the only step toward the goal a post
 * or a reply on X can move.
 */
async function startNextExperiment(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  strategy: Strategy,
  episodes: Doc<'episodes'>[],
  experiments: Doc<'experiments'>[],
  conversions: Doc<'conversions'>[],
  contradictions: Contradiction[],
  now: number
): Promise<{ experimentId: Id<'experiments'>; change: Change } | null> {
  if (experiments.some((experiment) => experiment.status === 'running')) return null
  const onVideo = persona.formats.some((format) => format.platform !== 'x')
  const live = episodes.filter((episode) => episode.status !== 'killed').length
  const sponsors = persona.sponsorDial > 0 && live >= persona.sponsorRampEpisodes
  const kinds: ExperimentKind[] = []
  for (const kind of EXPERIMENT_KINDS) {
    if (EXPERIMENT_SUBJECT[kind] === 'video' && !onVideo) continue
    if (kind === 'sponsor' && !sponsors) continue
    if ((await dimensionProblem(ctx, persona, kind)) !== null) continue
    kinds.push(kind)
  }
  const window = await goalWindow(ctx, persona, conversions, now)
  const history = historyOf(experiments)
  const next = pickNextExperiment({
    kinds,
    history,
    defaults: strategy.defaults,
    contradicted: contradictions.map((contradiction) => contradiction.kind),
    now,
  })
  if (!next) return null
  const metric: GoalMetric = EXPERIMENT_SUBJECT[next.kind] === 'video' ? pickGoalMetric(window) : 'follows'
  const retest = next.retestOf === undefined ? undefined : experiments.find((experiment) => experiment._id === next.retestOf)
  if (next.retestOf !== undefined && !retest)
    throw new Error(`the re-test points at experiment ${next.retestOf}, which the persona does not have`)
  const contradiction = retest ? contradictions.find((candidate) => candidate.source._id === retest._id) : undefined
  const name = `${EXPERIMENT_KIND_LABELS[next.kind]}: ${next.challenger.label} vs ${next.control.label}`
  const experimentId = await startExperiment(
    ctx,
    persona,
    {
      name,
      hypothesis: hypothesisOf(next, metric),
      kind: next.kind,
      metric,
      variants: [next.control, next.challenger],
      minExposures: METRIC_MIN_EXPOSURES[METRIC_DENOMINATOR[metric]],
      minConfidence: AUTO_MIN_CONFIDENCE,
      createdBy: 'analyst',
      ...(retest ? { retestOf: retest._id } : {}),
      reason: startReason({ next, metric, window, history, contradiction, timezone: persona.timezone, now }),
    },
    now
  )
  const phrase = retest
    ? `started testing "${next.control.label}" against "${next.challenger.label}" again, because later numbers no longer back it`
    : `started "${name}"`
  return { experimentId, change: { phrase } }
}

/** Where a persona stands against the goal: paid conversions of two spans, what one is worth, and what it tries next. */
export interface GoalStanding {
  windowDays: number
  paid: number
  previousPaid: number
  valuePerPaid: number
  currency: string
  /** The experiment that runs after the review, or null. */
  testing: string | null
}

/**
 * The goal note's words: paid customers this span with their value, the
 * trend against the span before, and what the persona tries next. The goal
 * itself (shared `workspaceGoal`) is said beside it, never in it.
 */
export function goalNoteText(standing: GoalStanding): string {
  const { windowDays, paid, previousPaid } = standing
  const money = (count: number) => `${grouped(count * standing.valuePerPaid)} ${standing.currency}`
  const customers = (count: number) => `${grouped(count)} paid ${count === 1 ? 'customer' : 'customers'}`
  const span = `in the last ${windowDays} days`
  const before = `in the ${windowDays} days before`
  const now =
    paid === 0
      ? previousPaid === 0
        ? `No paid customers yet ${span}, nor ${before}.`
        : `No paid customers ${span}, down from ${grouped(previousPaid)} (${money(previousPaid)}) ${before}.`
      : paid === previousPaid
        ? `${customers(paid)} ${span}, worth ${money(paid)}, the same as ${before}.`
        : previousPaid === 0
          ? `${customers(paid)} ${span}, worth ${money(paid)}, up from none ${before}.`
          : `${customers(paid)} ${span}, worth ${money(paid)}, ${paid > previousPaid ? 'up' : 'down'} from ${grouped(previousPaid)} (${money(previousPaid)}) ${before}.`
  const next = standing.testing !== null ? `Next: testing "${standing.testing}".` : 'Next: nothing new to test this week.'
  return `${now} ${next}`
}

/**
 * The goal note every review leaves, changes or not: where the persona stands
 * against the workspace's goal (paid conversions by link or by code, this
 * span against the one before, at the workspace's value per paid) and the
 * experiment it runs next. It supersedes the note of the review before.
 */
async function writeGoalNote(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  conversions: Doc<'conversions'>[],
  running: Doc<'experiments'> | null,
  now: number
): Promise<Id<'memories'>> {
  const workspace = await workspaceOf(ctx, persona)
  const since = now - STANDING_WINDOW_DAYS * DAY_MS
  const paid = conversions.filter((conversion) => conversion.kind === 'paid' && conversion.at < now)
  const current = paid.filter((conversion) => conversion.at >= since)
  const previous = paid.filter((conversion) => conversion.at >= since - STANDING_WINDOW_DAYS * DAY_MS && conversion.at < since)
  const text = goalNoteText({
    windowDays: STANDING_WINDOW_DAYS,
    paid: current.length,
    previousPaid: previous.length,
    valuePerPaid: workspace.valuePerPaid,
    currency: workspace.currency,
    testing: running === null ? null : running.name,
  })
  const episodeIds = [...new Set(current.flatMap((conversion) => (conversion.episodeId === undefined ? [] : [conversion.episodeId])))]
  const noteId = await ctx.db.insert('memories', {
    personaId: persona._id,
    kind: 'goal_note',
    text,
    actor: 'analyst',
    evidence: { ...(running === null ? {} : { experimentId: running._id }), episodeIds, signalIds: [] },
    status: 'active',
    createdAt: now,
  })
  await supersedeOthers(ctx, { _id: noteId, personaId: persona._id, kind: 'goal_note' }, () => true)
  return noteId
}

/**
 * The weekly review, in order: pillar weights, publish hours, contradicted
 * defaults, the next experiment. The publish hours stay while a publish time
 * experiment runs: moving the hour under it would change what its variants
 * are offsets from. Each change writes its journal entry; the
 * review then stamps `strategy.reviewedAt` and, when anything changed, posts
 * one chat message naming the changes. Every change that moves the plan
 * (pillar weights, a publish hour) also leaves a learning, which supersedes
 * the persona's older learning on the same subject; a started experiment is a
 * question, not a learning, and the goal note names it as what comes next.
 * Nothing changed: no message and no journal entry, only the stamp and the
 * goal note, which every review leaves.
 */
export async function reviewStrategy(ctx: MutationCtx, persona: Doc<'personas'>, now: number): Promise<ReviewOutcome> {
  const episodes = await ctx.db
    .query('episodes')
    .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
    .collect()
  const conversions = await ctx.db
    .query('conversions')
    .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id))
    .collect()
  const experiments = await ctx.db
    .query('experiments')
    .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id))
    .collect()
  // No strategy yet: an empty weight list reads as equal shares (shared `pillarWeights`).
  let strategy: Strategy = persona.strategy ?? { pillarWeights: [], defaults: [] }
  const changes: Change[] = []

  const pillars = await reviewPillars(ctx, persona, strategy, episodes, conversions, now)
  if (pillars) {
    strategy = pillars.strategy
    changes.push(pillars.change)
  }
  const testingHours = experiments.some((experiment) => experiment.status === 'running' && experiment.kind === 'publish_time')
  if (!testingHours) changes.push(...(await reviewPublishHours(ctx, persona, episodes, now)))
  const contradictions = await findContradictions(ctx, persona, strategy, experiments)
  const started = await startNextExperiment(ctx, persona, strategy, episodes, experiments, conversions, contradictions, now)
  if (started) changes.push(started.change)

  const running = started ? await ctx.db.get(started.experimentId) : experiments.find((experiment) => experiment.status === 'running')
  const goalNoteId = await writeGoalNote(ctx, persona, conversions, running ?? null, now)

  await ctx.db.patch(persona._id, { strategy: { ...strategy, reviewedAt: now } })
  if (changes.length > 0) {
    await ctx.db.insert('messages', {
      personaId: persona._id,
      author: 'persona',
      text: `I reviewed my strategy: I ${joinAnd(changes.map((change) => change.phrase))}. The Strategy page has the reasons.`,
      createdAt: now,
    })
  }
  return { changes: changes.length, goalNoteId, ...(started ? { startedExperimentId: started.experimentId } : {}) }
}

/**
 * What the strategy page reads: the workspace's goal with the persona's
 * newest goal note, its learnings, active and superseded, the newest journal
 * entries with the titles of the signals they name, and its newest strategy
 * review job, read by its own index: the hourly signal polls and the daily
 * pulls bury a weekly review among the persona's newest jobs within days.
 */
export async function strategyView(
  ctx: Reader,
  persona: Doc<'personas'>
): Promise<{
  goal: { text: string; note: Doc<'memories'> | null }
  learnings: Doc<'memories'>[]
  journal: Doc<'journal'>[]
  signals: Pick<Doc<'signals'>, '_id' | 'title'>[]
  reviewJob: Doc<'jobs'> | null
}> {
  const memories = await ctx.db
    .query('memories')
    .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id))
    .collect()
  const journal = await ctx.db
    .query('journal')
    .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id))
    .order('desc')
    .take(JOURNAL_PAGE)
  const reviewJob = await ctx.db
    .query('jobs')
    .withIndex('by_persona_kind', (q) => q.eq('personaId', persona._id).eq('kind', 'review_strategy'))
    .order('desc')
    .first()
  // The signals the journal's evidence names (a swapped concept's old and new signal), so the page can say
  // them by title. A used signal never ages out (internal/schedule.ts), so one that is gone was deleted by
  // hand, and its entry names it no more.
  const signals: Pick<Doc<'signals'>, '_id' | 'title'>[] = []
  for (const signalId of new Set(journal.flatMap((entry) => entry.evidence.signalIds))) {
    const signal = await ctx.db.get(signalId)
    if (signal) signals.push({ _id: signal._id, title: signal.title })
  }
  const workspace = await workspaceOf(ctx, persona)
  const [note] = await activeEntries(ctx, persona._id, 'goal_note')
  return {
    goal: { text: workspaceGoal(workspace.sponsorName), note: note ?? null },
    learnings: memories.filter((memory) => memory.kind === 'learning'),
    journal,
    signals,
    reviewJob,
  }
}
