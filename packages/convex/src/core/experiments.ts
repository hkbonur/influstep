import {
  EXPERIMENT_KIND_LABELS,
  METRIC_DENOMINATOR,
  METRIC_RATE_LABELS,
  PLATFORM_LABELS,
  confidencePercent,
  effectiveVariant,
  isPost,
  variantRate,
  type EffectiveVariant,
  type ExperimentKind,
  type JournalActor,
  type MetricKey,
  type VariantStats,
} from '@influstep/shared'
import type { Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { refusal } from '../lib/errors'
import type { journalNumberValidator, strategyDefaultValidator, variantValidator } from '../lib/validators'
import { DESCRIPTION_FORMATS, isDescriptionFormat } from './attribution'
import { hourText } from './dates'
import { activeDiscountCodes } from './discounts'
import { publishHourFor } from './formats'
import { latestPerPublication } from './report'

/**
 * Experiments (CONTEXT.md, "Experiment"): the one place one starts, stops and
 * is decided, for the analyst's strategy review and the operator alike, and
 * how a variant's exposures and successes are counted.
 */

type Reader = { db: QueryCtx['db'] }
type Variant = Infer<typeof variantValidator>
type StoredDefault = Infer<typeof strategyDefaultValidator>
type JournalNumber = Infer<typeof journalNumberValidator>

/** The variant an episode carries, with the dimension its experiment varies, as shared `effectiveVariant` reads it. */
export type EpisodeVariant = Variant & { kind: ExperimentKind }

/**
 * The variant an episode carries; none when the episode is in no experiment.
 * A key its experiment does not have is a bug, never a reason to treat the
 * episode as if it carried no variant.
 */
export function episodeVariant(
  episode: Pick<Doc<'episodes'>, '_id' | 'variantKey'>,
  experiment: Doc<'experiments'> | null
): EpisodeVariant | undefined {
  if (episode.variantKey === undefined) return undefined
  if (!experiment) throw new Error(`episode ${episode._id} carries variant "${episode.variantKey}" but no experiment`)
  const variant = experiment.variants.find((candidate) => candidate.key === episode.variantKey)
  if (!variant)
    throw new Error(`episode ${episode._id} carries variant "${episode.variantKey}", which experiment ${experiment._id} does not have`)
  return { ...variant, kind: experiment.kind }
}

/**
 * The variant a planned episode will carry, read before its row exists (the
 * placement of a new idea needs its publish offset). Same rule as
 * `episodeVariant`: a key its experiment does not have is a bug.
 */
export async function plannedVariant(
  ctx: Reader,
  planned: { experimentId?: Id<'experiments'>; variantKey?: string }
): Promise<EpisodeVariant | undefined> {
  if (planned.variantKey === undefined) return undefined
  if (planned.experimentId === undefined) throw new Error(`a planned episode carries variant "${planned.variantKey}" but no experiment`)
  const experiment = await ctx.db.get(planned.experimentId)
  if (!experiment) throw new Error(`experiment ${planned.experimentId} not found`)
  const variant = experiment.variants.find((candidate) => candidate.key === planned.variantKey)
  if (!variant) throw new Error(`experiment ${experiment._id} has no variant "${planned.variantKey}"`)
  return { ...variant, kind: experiment.kind }
}

/**
 * What an episode does on one dimension: shared `effectiveVariant` over the
 * variant its experiment gave it and the persona's defaults in force.
 */
export async function episodeEffectiveVariant(
  ctx: Reader,
  kind: ExperimentKind,
  episode: Pick<Doc<'episodes'>, '_id' | 'variantKey' | 'experimentId' | 'sponsorSegment'>,
  persona: Pick<Doc<'personas'>, 'strategy'>
): Promise<EffectiveVariant> {
  const experiment = episode.experimentId === undefined ? null : await ctx.db.get(episode.experimentId)
  return effectiveVariant(
    kind,
    { variant: episodeVariant(episode, experiment), sponsorSegment: episode.sponsorSegment },
    persona.strategy?.defaults
  )
}

/** A variant's label. The key always comes from the experiment's own variants, so a missing one is a bug. */
function variantLabel(experiment: Pick<Doc<'experiments'>, 'variants'>, key: string): string {
  const variant = experiment.variants.find((candidate) => candidate.key === key)
  if (!variant) throw new Error(`no variant "${key}" in the experiment`)
  return variant.label
}

/** An episode the stats count: it went out, so its numbers mean something. */
function counted(episode: Doc<'episodes'>): boolean {
  return episode.status === 'measured' || episode.status === 'published'
}

/**
 * Exposures and successes per variant key over the given episodes, by the
 * metric. Signups and paid are rates over clicks, so only link-attributed
 * conversions count: a code redemption has no click behind it and would hand
 * the variant successes without exposures.
 */
async function measure(
  ctx: Reader,
  personaId: Id<'personas'>,
  metric: MetricKey,
  keys: readonly string[],
  assigned: readonly { episode: Doc<'episodes'>; key: string }[]
): Promise<{ stats: VariantStats[]; episodeIds: Id<'episodes'>[] }> {
  const stats = new Map<string, VariantStats>(keys.map((key) => [key, { key, episodes: 0, exposures: 0, successes: 0 }]))
  const denominator = METRIC_DENOMINATOR[metric]
  const conversions =
    metric === 'signups' || metric === 'paid'
      ? await ctx.db
          .query('conversions')
          .withIndex('by_persona_time', (q) => q.eq('personaId', personaId))
          .collect()
      : []
  const episodeIds: Id<'episodes'>[] = []
  for (const { episode, key } of assigned) {
    const entry = stats.get(key)
    if (!entry) continue
    const snapshots = latestPerPublication(
      await ctx.db
        .query('metricSnapshots')
        .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
        .collect()
    )
    const views = snapshots.reduce((sum, snapshot) => sum + snapshot.counts.views, 0)
    const follows = snapshots.reduce((sum, snapshot) => sum + snapshot.counts.follows, 0)
    const watched = snapshots.reduce((sum, snapshot) => sum + snapshot.counts.views * snapshot.counts.watchRate, 0)
    const links = await ctx.db
      .query('links')
      .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
      .collect()
    const clicks = links.reduce((sum, link) => sum + link.clicks, 0)
    const own = conversions.filter((conversion) => conversion.episodeId === episode._id && conversion.via === 'utm')
    const signups = own.filter((conversion) => conversion.kind === 'signup').length
    const paid = own.filter((conversion) => conversion.kind === 'paid').length
    const successes = { views, watch_rate: Math.round(watched), follows, clicks, signups, paid }[metric]
    entry.episodes += 1
    entry.exposures += denominator === 'views' ? views : denominator === 'clicks' ? clicks : 1
    entry.successes += successes
    episodeIds.push(episode._id)
  }
  return { stats: [...stats.values()], episodeIds }
}

async function experimentMeasure(ctx: Reader, experiment: Doc<'experiments'>) {
  const episodes = await ctx.db
    .query('episodes')
    .withIndex('by_persona', (q) => q.eq('personaId', experiment.personaId))
    .collect()
  const assigned = episodes.flatMap((episode) => {
    if (episode.experimentId !== experiment._id || episode.variantKey === undefined || !counted(episode)) return []
    return [{ episode, key: episode.variantKey }]
  })
  return measure(
    ctx,
    experiment.personaId,
    experiment.metric,
    experiment.variants.map((variant) => variant.key),
    assigned
  )
}

/** Exposures and successes per variant, from the experiment's published and measured episodes, by its metric. */
export async function variantStatsFor(ctx: Reader, experiment: Doc<'experiments'>): Promise<VariantStats[]> {
  return (await experimentMeasure(ctx, experiment)).stats
}

/**
 * How a default has done since it became one: the persona's published and
 * measured videos published after `since` whose effective variant on `kind`
 * (shared `effectiveVariant`) is `key`, by `metric`. An episode in an
 * experiment of that dimension counts by its own variant; any other by the
 * default in force. On the sponsor dimension only sponsored videos count.
 *
 * No episode records when it was scripted yet, so the window goes by publish
 * time: an episode scripted under the old default and published after the
 * decision can slip in. Slice 9's just-in-time scripts shrink that gap.
 */
export async function variantStatsSince(
  ctx: Reader,
  persona: Doc<'personas'>,
  kind: ExperimentKind,
  key: string,
  since: number,
  metric: MetricKey
): Promise<VariantStats & { episodeIds: Id<'episodes'>[] }> {
  const episodes = await ctx.db
    .query('episodes')
    .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
    .collect()
  const experiments = new Map<Id<'experiments'>, Doc<'experiments'> | null>()
  const cachedExperiment = async (experimentId: Id<'experiments'>) => {
    const known = experiments.get(experimentId)
    if (known !== undefined) return known
    const loaded = await ctx.db.get(experimentId)
    experiments.set(experimentId, loaded)
    return loaded
  }
  const assigned: { episode: Doc<'episodes'>; key: string }[] = []
  for (const episode of episodes) {
    if (isPost(episode.kind) || !counted(episode)) continue
    // An unsponsored video places no sponsor. Shared `effectiveVariant` gives it
    // the control, but a sponsor decision compared sponsored videos only (the
    // planner gives sponsor variants to sponsored slots), so it says nothing
    // about the default.
    if (kind === 'sponsor' && episode.sponsorSegment === 'none') continue
    if (episode.publishedAt === undefined || episode.publishedAt <= since) continue
    const experiment = episode.experimentId === undefined ? null : await cachedExperiment(episode.experimentId)
    const effective = effectiveVariant(
      kind,
      { variant: episodeVariant(episode, experiment), sponsorSegment: episode.sponsorSegment },
      persona.strategy?.defaults
    )
    if (effective.key === key) assigned.push({ episode, key })
  }
  const { stats, episodeIds } = await measure(ctx, persona._id, metric, [key], assigned)
  const [only] = stats
  if (!only) throw new Error(`no stats for ${kind} "${key}"`)
  return { ...only, episodeIds }
}

/**
 * A rate as people read it: a percentage with two decimals, as the
 * Experiments table shows it (click rates sit well under 1%, so one decimal
 * would read 0.26% against 0.13% as 0.3% against 0.1%), or views per episode
 * as a whole number.
 */
export function rateText(metric: MetricKey, rate: number): string {
  if (METRIC_DENOMINATOR[metric] === 'episodes') return grouped(rate)
  return `${(rate * 100).toFixed(2)}%`
}

/** A rate as a journal number: a percentage rounded to 0.01, or views per episode rounded. */
export function rateNumber(metric: MetricKey, rate: number): number {
  if (METRIC_DENOMINATOR[metric] === 'episodes') return Math.round(rate)
  return Math.round(rate * 10000) / 100
}

/** The label a rate's journal number carries, with its unit. */
function rateUnit(metric: MetricKey): string {
  if (METRIC_DENOMINATOR[metric] === 'episodes') return METRIC_RATE_LABELS[metric]
  return `${METRIC_RATE_LABELS[metric]} (%)`
}

/** A whole number with thousands separators, written out here so the text never depends on the runtime's locale. */
export function grouped(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** A sentence the operator typed, ended with a period when it has no end of its own. */
function sentence(text: string): string {
  const trimmed = text.trim()
  if (/[.!?]$/.test(trimmed)) return trimmed
  return `${trimmed}.`
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

async function journal(
  ctx: MutationCtx,
  entry: {
    personaId: Id<'personas'>
    kind: Doc<'journal'>['kind']
    actor: JournalActor
    text: string
    reason: string
    experimentId?: Id<'experiments'>
    episodeIds: Id<'episodes'>[]
    numbers: JournalNumber[]
    at: number
  }
): Promise<Id<'journal'>> {
  return ctx.db.insert('journal', {
    personaId: entry.personaId,
    kind: entry.kind,
    actor: entry.actor,
    text: entry.text,
    reason: entry.reason,
    evidence: {
      ...(entry.experimentId === undefined ? {} : { experimentId: entry.experimentId }),
      episodeIds: entry.episodeIds,
      // Only a last check's swap names signals (core/research.ts); no experiment entry does.
      signalIds: [],
      numbers: entry.numbers,
    },
    createdAt: entry.at,
  })
}

export interface StartExperimentInput {
  name: string
  hypothesis: string
  kind: ExperimentKind
  metric: MetricKey
  variants: Variant[]
  minExposures: number
  minConfidence: number
  createdBy: JournalActor
  /** The default this experiment tests again, when later data contradicted it. */
  retestOf?: Id<'experiments'>
  /** Why it starts, for the journal: the review's reasoning, or the operator's hypothesis. */
  reason: string
}

/**
 * The one place an experiment starts. One runs at a time per persona, so
 * every episode carries one variant. `now` is the moment it starts; only the
 * seed passes one from the past.
 */
export async function startExperiment(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  input: StartExperimentInput,
  now = Date.now()
): Promise<Id<'experiments'>> {
  if (input.variants.length < 2) throw refusal('An experiment needs at least two variants.')
  const keys = new Set(input.variants.map((variant) => variant.key))
  if (keys.size !== input.variants.length) throw refusal('Variant keys must be unique.')
  for (const variant of input.variants) {
    if (variant.lengthFactor === undefined) continue
    if (input.kind !== 'length') throw refusal(`Only an episode length experiment scales length; "${variant.label}" has a length factor.`)
    if (!(variant.lengthFactor > 0)) throw refusal(`"${variant.label}" needs a length factor above 0.`)
  }
  for (const variant of input.variants) {
    if (variant.hourOffset === undefined) {
      if (input.kind === 'publish_time') throw refusal(`"${variant.label}" needs an hour offset: how many hours it moves the publish hour.`)
      continue
    }
    if (input.kind !== 'publish_time')
      throw refusal(`Only a publish time experiment moves the hour; "${variant.label}" has an hour offset.`)
    if (!Number.isInteger(variant.hourOffset) || Math.abs(variant.hourOffset) > 23)
      throw refusal(`"${variant.label}" moves the hour by a whole number of hours, at most 23.`)
  }
  // The footer knows two orders (core/attribution.ts `descriptionFooter`); a key it does not know would reach
  // every description of the experiment's episodes.
  if (input.kind === 'description_format') {
    for (const variant of input.variants) {
      if (isDescriptionFormat(variant.key)) continue
      throw refusal(
        `"${variant.label}" is no description format; the footer puts either the ${DESCRIPTION_FORMATS.join(' or the ')} first.`
      )
    }
  }
  await assertDimensionApplies(ctx, persona, input.kind)
  const running = await ctx.db
    .query('experiments')
    .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'running'))
    .first()
  if (running) throw refusal(`"${running.name}" is still running; stop it first so episodes carry one variant.`)
  const experimentId = await ctx.db.insert('experiments', {
    personaId: persona._id,
    name: input.name,
    hypothesis: input.hypothesis,
    kind: input.kind,
    metric: input.metric,
    variants: input.variants,
    status: 'running',
    minExposures: input.minExposures,
    minConfidence: input.minConfidence,
    createdBy: input.createdBy,
    ...(input.retestOf === undefined ? {} : { retestOf: input.retestOf }),
    createdAt: now,
  })
  await journal(ctx, {
    personaId: persona._id,
    kind: 'experiment_started',
    actor: input.createdBy,
    text: `Started "${input.name}".`,
    reason: input.reason,
    experimentId,
    episodeIds: [],
    numbers: [
      { label: `${upperFirst(METRIC_DENOMINATOR[input.metric])} needed per variant`, value: input.minExposures },
      { label: 'Confidence needed (%)', value: Math.round(input.minConfidence * 100) },
    ],
    at: now,
  })
  return experimentId
}

/**
 * Publish time and description format compare nothing for some personas, so
 * an experiment on them is refused there, for the operator and the review
 * alike (core/strategy.ts leaves the kind out by the same rule). Publish time
 * moves only video platforms' hours; a description format orders a code and a
 * link, which an X post never prints.
 */
async function assertDimensionApplies(ctx: Reader, persona: Doc<'personas'>, kind: ExperimentKind): Promise<void> {
  if (kind !== 'publish_time' && kind !== 'description_format') return
  if (!persona.formats.some((format) => format.platform !== 'x')) {
    throw refusal(
      `${persona.name} publishes only on X, which keeps its own hours and prints no footer, so a ${EXPERIMENT_KIND_LABELS[kind].toLowerCase()} test would compare nothing.`
    )
  }
  if (kind !== 'description_format') return
  const codes = await activeDiscountCodes(ctx, persona._id)
  if (codes.length === 0)
    throw refusal(`${persona.name} has no discount code in force, so a description format test would compare nothing.`)
}

/**
 * Whether a dimension applies to the persona now, the same rule as
 * `assertDimensionApplies` without the refusal, for the strategy review.
 */
export async function dimensionApplies(ctx: Reader, persona: Doc<'personas'>, kind: ExperimentKind): Promise<boolean> {
  if (kind !== 'publish_time' && kind !== 'description_format') return true
  if (!persona.formats.some((format) => format.platform !== 'x')) return false
  if (kind !== 'description_format') return true
  return (await activeDiscountCodes(ctx, persona._id)).length > 0
}

/**
 * The persona's video formats after a decided publish time test: every
 * platform but X moved by the winner's offset, kept within the day (core
 * formats `publishHourFor`). The hours live on the formats, so the decision
 * stores no default.
 */
function shiftedVideoHours(formats: Doc<'personas'>['formats'], offset: number): Doc<'personas'>['formats'] {
  return formats.map((format) => ({ ...format, publishHour: publishHourFor(format, offset) }))
}

function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** The video platforms' new hours for the journal: "YouTube 13:00 (was 16:00) and TikTok 15:00 (was 18:00)". */
function videoHoursChange(before: Doc<'personas'>['formats'], after: Doc<'personas'>['formats']): string {
  return joinAnd(
    after.flatMap((format) => {
      if (format.platform === 'x') return []
      const old = before.find((candidate) => candidate.platform === format.platform)
      if (!old) throw new Error(`the ${format.platform} format appeared while its hour moved`)
      const label = `${PLATFORM_LABELS[format.platform]} ${hourText(format.publishHour)}`
      if (old.publishHour === format.publishHour) return [label]
      return [`${label} (was ${hourText(old.publishHour)})`]
    })
  )
}

/** The video platforms' hours for the chat: "YouTube videos at 13:00 and TikTok videos at 15:00". */
function videoHoursText(formats: Doc<'personas'>['formats']): string {
  return joinAnd(
    formats.flatMap((format) =>
      format.platform === 'x' ? [] : [`${PLATFORM_LABELS[format.platform]} videos at ${hourText(format.publishHour)}`]
    )
  )
}

/**
 * The analyst's note on a decision it reached on the numbers, the lead of the
 * chat message `applyExperimentDecision` posts: the winner, how far it leads
 * on the experiment's rate, and the confidence, written as the learning
 * writes it (`confidencePercent`, so it never reads 100%).
 */
export function analystDecisionNote(
  experiment: Pick<Doc<'experiments'>, 'metric' | 'variants'>,
  decision: Pick<DecisionInput, 'winnerKey' | 'lift' | 'confidence'>
): string {
  const winner = variantLabel(experiment, decision.winnerKey)
  return `"${winner}" leads on ${METRIC_RATE_LABELS[experiment.metric]} by ${Math.round(decision.lift * 100)}% at ${confidencePercent(decision.confidence)}% confidence.`
}

/**
 * A decision as it reaches `applyExperimentDecision`. The analyst's carries
 * the two rates it was decided on and the variant that came second; the
 * operator's verdict carries none of them.
 */
export interface DecisionInput {
  winnerKey: string
  lift: number
  confidence: number
  winnerRate?: number
  runnerUpRate?: number
  runnerUpKey?: string
}

/** The numbers an analyst's decision was reached on: the winner's rate, the runner-up's, and which variant came second. */
interface DecisionRates {
  winnerRate: number
  runnerUpRate: number
  runnerUpKey: string
}

/**
 * The rates of a decision, all three or none: a decision with only some of
 * them is a bug in its caller, never a decision without rates.
 */
function decisionRates(experiment: Doc<'experiments'>, decision: DecisionInput): DecisionRates | undefined {
  const { winnerRate, runnerUpRate, runnerUpKey } = decision
  if (winnerRate === undefined && runnerUpRate === undefined && runnerUpKey === undefined) return undefined
  if (winnerRate === undefined || runnerUpRate === undefined || runnerUpKey === undefined)
    throw new Error(`a decision on experiment ${experiment._id} needs the winner's rate, the runner-up's rate and its key together`)
  if (runnerUpKey === decision.winnerKey) throw new Error(`experiment ${experiment._id} names its winner "${runnerUpKey}" as the runner-up`)
  if (!experiment.variants.some((variant) => variant.key === runnerUpKey))
    throw new Error(`experiment ${experiment._id} has no runner-up "${runnerUpKey}"`)
  return { winnerRate, runnerUpRate, runnerUpKey }
}

/** The learning a decision writes, from its numbers, or the operator's note for the operator's own verdict. */
function decisionLearningText(args: {
  experiment: Pick<Doc<'experiments'>, 'kind' | 'metric' | 'variants'>
  winnerKey: string
  actor: JournalActor
  note: string
  stats: readonly VariantStats[]
  rates?: DecisionRates
  confidence: number
}): string {
  const { experiment } = args
  const label = (key: string) => variantLabel(experiment, key)
  const winner = `"${label(args.winnerKey)}"`
  const dimension = EXPERIMENT_KIND_LABELS[experiment.kind]
  const others = experiment.variants.filter((variant) => variant.key !== args.winnerKey).map((variant) => `"${variant.label}"`)
  if (args.actor === 'operator') {
    const reason = args.note.trim() === '' ? '.' : `: ${sentence(args.note)}`
    return `${dimension}: ${winner} over ${others.join(' and ')}, chosen by the operator${reason}`
  }
  if (!args.rates) throw new Error('an analyst decision needs the winner and runner-up rates it was decided on')
  const exposures = args.stats.reduce((sum, stat) => sum + stat.exposures, 0)
  return (
    `${dimension}: ${winner} beat "${label(args.rates.runnerUpKey)}" on ${METRIC_RATE_LABELS[experiment.metric]}, ` +
    `${rateText(experiment.metric, args.rates.winnerRate)} against ${rateText(experiment.metric, args.rates.runnerUpRate)} ` +
    `over ${grouped(exposures)} ${METRIC_DENOMINATOR[experiment.metric]}, ${confidencePercent(args.confidence)}% confidence.`
  )
}

/**
 * The one place a decision lands, for the daily evaluation and the
 * operator's override alike. The winner becomes the persona's default on the
 * experiment's dimension, a learning the writer reads (the older learning on
 * that dimension is superseded), a journal entry with the numbers, and one
 * chat message that says what changes. Only a running experiment is decided,
 * so a decision lands once: the operator's form can still be open when the
 * daily evaluation decides, and a second click sends a second override.
 * `now` is the moment of the decision; only the seed passes one from the past.
 */
export async function applyExperimentDecision(
  ctx: MutationCtx,
  experiment: Doc<'experiments'>,
  decision: DecisionInput,
  actor: JournalActor,
  note: string,
  now = Date.now()
): Promise<void> {
  if (experiment.status === 'stopped') throw refusal(`"${experiment.name}" was stopped, so it cannot be decided.`)
  if (experiment.status === 'decided') throw refusal(`"${experiment.name}" is already decided.`)
  const winner = experiment.variants.find((variant) => variant.key === decision.winnerKey)
  if (!winner) throw refusal(`There is no variant "${decision.winnerKey}".`)
  const persona = await ctx.db.get(experiment.personaId)
  if (!persona) throw new Error(`persona ${experiment.personaId} not found`)
  const rates = decisionRates(experiment, decision)

  await ctx.db.patch(experiment._id, {
    status: 'decided',
    decision: {
      winnerKey: decision.winnerKey,
      lift: decision.lift,
      confidence: decision.confidence,
      note,
      decidedAt: now,
      byOperator: actor === 'operator',
      ...rates,
    },
  })

  // A decided publish time moves the video formats' hours, their one home, and stores no default: the
  // next publish time test then runs around the new hour.
  const hoursBefore = persona.formats
  let hoursAfter = persona.formats
  if (experiment.kind === 'publish_time') {
    if (winner.hourOffset === undefined)
      throw new Error(`publish time variant "${winner.key}" of experiment ${experiment._id} has no hour offset`)
    hoursAfter = shiftedVideoHours(persona.formats, winner.hourOffset)
    await ctx.db.patch(persona._id, { formats: hoursAfter })
  } else {
    const inForce: StoredDefault = {
      kind: experiment.kind,
      key: winner.key,
      label: winner.label,
      description: winner.description,
      ...(winner.lengthFactor === undefined ? {} : { lengthFactor: winner.lengthFactor }),
      ...(winner.hourOffset === undefined ? {} : { hourOffset: winner.hourOffset }),
      experimentId: experiment._id,
      since: now,
    }
    // No strategy yet: an empty weight list reads as equal shares (shared `pillarWeights`).
    const strategy = persona.strategy ?? { pillarWeights: [], defaults: [] }
    await ctx.db.patch(persona._id, {
      strategy: { ...strategy, defaults: [...strategy.defaults.filter((entry) => entry.kind !== experiment.kind), inForce] },
    })
  }

  const { stats, episodeIds } = await experimentMeasure(ctx, experiment)
  const confidence = actor === 'operator' ? 1 : decision.confidence
  const text = decisionLearningText({ experiment, winnerKey: winner.key, actor, note, stats, rates, confidence })
  const learningId = await ctx.db.insert('memories', {
    personaId: persona._id,
    kind: 'learning',
    text,
    dimension: experiment.kind,
    evidence: { experimentId: experiment._id, episodeIds, signalIds: [] },
    confidence,
    status: 'active',
    createdAt: now,
  })
  const earlier = await ctx.db
    .query('memories')
    .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'active'))
    .collect()
  for (const memory of earlier) {
    // Only an older learning on the same dimension gives way; a brief or a problem is no learning.
    if (memory.kind !== 'learning') continue
    if (memory._id === learningId || memory.dimension !== experiment.kind) continue
    await ctx.db.patch(memory._id, { status: 'superseded', supersededBy: learningId })
  }

  const numbers: JournalNumber[] = stats.flatMap((stat) => {
    const label = variantLabel(experiment, stat.key)
    return [
      { label: `"${label}" ${rateUnit(experiment.metric)}`, value: rateNumber(experiment.metric, variantRate(stat)) },
      { label: `"${label}" ${METRIC_DENOMINATOR[experiment.metric]}`, value: stat.exposures },
    ]
  })
  if (actor === 'analyst') numbers.push({ label: 'Confidence (%)', value: Math.floor(decision.confidence * 1000) / 10 })
  await journal(ctx, {
    personaId: persona._id,
    kind: 'experiment_decided',
    actor,
    text:
      experiment.kind === 'publish_time'
        ? `"${winner.label}" won. Video hours now: ${videoHoursChange(hoursBefore, hoursAfter)}.`
        : `"${winner.label}" is the default for ${EXPERIMENT_KIND_LABELS[experiment.kind].toLowerCase()} now.`,
    reason: `"${experiment.name}" is decided. ${text}`,
    experimentId: experiment._id,
    episodeIds,
    numbers,
    at: now,
  })

  const lead = actor === 'operator' ? `you picked "${winner.label}".${note.trim() === '' ? '' : ` ${sentence(note)}`}` : sentence(note)
  const from =
    experiment.kind === 'publish_time'
      ? `publish ${videoHoursText(hoursAfter)}.`
      : winner.description.trim() === ''
        ? `follow "${winner.label}".`
        : sentence(lowerFirst(winner.description.trim()))
  await ctx.db.insert('messages', {
    personaId: persona._id,
    author: 'persona',
    text: `Experiment "${experiment.name}" is decided: ${lead} From now on I ${from}`,
    createdAt: now,
  })
}

/** The one place an experiment stops: only a running one, and its episodes keep the variant they carry. */
export async function stopExperiment(
  ctx: MutationCtx,
  experimentId: Id<'experiments'>,
  actor: JournalActor,
  now = Date.now()
): Promise<void> {
  const experiment = await ctx.db.get(experimentId)
  if (!experiment) throw new Error(`experiment ${experimentId} not found`)
  if (experiment.status !== 'running') throw refusal(`"${experiment.name}" is not running.`)
  await ctx.db.patch(experiment._id, { status: 'stopped' })
  const { stats, episodeIds } = await experimentMeasure(ctx, experiment)
  await journal(ctx, {
    personaId: experiment.personaId,
    kind: 'experiment_stopped',
    actor,
    text: `Stopped "${experiment.name}" before it was decided.`,
    reason:
      actor === 'operator'
        ? 'You stopped it, so nothing changes: the persona keeps doing what it did, and its episodes keep their variant.'
        : 'The analyst stopped it, so nothing changes: the persona keeps doing what it did, and its episodes keep their variant.',
    experimentId: experiment._id,
    episodeIds,
    numbers: stats.map((stat) => ({
      label: `"${variantLabel(experiment, stat.key)}" ${METRIC_DENOMINATOR[experiment.metric]}`,
      value: stat.exposures,
    })),
    at: now,
  })
}
