import {
  DEFAULT_LENGTH_MIX,
  allocatePillars,
  leastAssigned,
  pickLengths,
  pillarWeights,
  postSlotHours,
  type ExperimentKind,
  type LengthMix,
  type PillarWeight,
  type PlatformFormat,
  type PostIntent,
  type PostKind,
  type PostKindVariantKey,
  type PostLength,
  type SponsorSegment,
  type XCadence,
} from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import { addDays, dayKey, instantAt } from './dates'

/**
 * The weekly plan (CONTEXT.md, "Plan"): which days get an episode, which of
 * those carry the sponsor, which pillar or signal each draws from, and which
 * experiment variant it is assigned. Pure, so the rules are testable without
 * a database; the writer's plan_week job feeds it rows and stores the output.
 */

/** How far back the episodes a pillar already had count toward its share (shared `allocatePillars`). */
export const PILLAR_HISTORY_DAYS = 28

export interface PlannerPersona {
  pillars: string[]
  sponsorDial: number
  sponsorRampEpisodes: number
  episodesPerWeek: number
  /** Episodes this persona has planned so far, for the sponsor ramp. */
  episodeCount: number
}

export interface PlannerSignal {
  id: string
  title: string
  score: number
  topics: string[]
}

export interface PlannerExperiment {
  id: string
  /** The dimension it varies: a sponsor experiment's variants go only to sponsored slots. */
  kind: ExperimentKind
  variantKeys: string[]
  /** Episodes already assigned per variant, so assignment stays balanced. */
  assigned: Record<string, number>
}

export interface PlannedEpisode {
  plannedFor: string
  pillar: string
  signalId?: string
  concept: string
  sponsorSegment: SponsorSegment
  experimentId?: string
  variantKey?: string
}

/**
 * The concept a signal becomes: the one rule the planner, the operator's
 * "make an episode" on the Signals page and the last check's swap all use.
 */
export function signalConcept(title: string): string {
  return `React to: ${title}`
}

/** Weekday slots by cadence: spread across the week, weekends last. */
const SLOT_ORDER = [1, 3, 5, 2, 4, 0, 6] // Tue, Thu, Sat, Wed, Fri, Mon, Sun offsets from Monday

export function planWeek(args: {
  weekStart: string
  persona: PlannerPersona
  /** The persona's effective pillar weights (shared `pillarWeights`). */
  pillarWeights: PillarWeight[]
  /** The persona's episodes per pillar of the last PILLAR_HISTORY_DAYS days, so the weights hold across weeks. */
  priorCounts: Record<string, number>
  signals: PlannerSignal[]
  experiment?: PlannerExperiment
  /** Days that already hold an episode for this persona. */
  takenDays: string[]
}): PlannedEpisode[] {
  const { persona } = args
  const count = Math.max(0, Math.min(7, Math.round(persona.episodesPerWeek)))
  if (count === 0 || persona.pillars.length === 0) return []

  const days = SLOT_ORDER.slice(0, count)
    .map((offset) => addDays(args.weekStart, offset))
    .filter((day) => !args.takenDays.includes(day))
    .sort()

  // The caller passes each signal's freshness as its score (shared `signalFreshness`), so the freshest leads.
  const rankedSignals = [...args.signals].sort((a, b) => b.score - a.score)
  // Two of five reactive, the rest evergreen (docs/plan.md, idea 7).
  const reactiveCount = Math.min(rankedSignals.length, Math.max(1, Math.round(days.length * 0.4)))

  const sponsoredSlots = sponsoredSlotIndexes(days.length, persona)
  const assigned = { ...args.experiment?.assigned }

  // Reactive slots take the pillar their signal is about; the evergreen slots share the rest out by weight,
  // counting this week's reactive slots with the episodes the pillars already had.
  const reactivePillars = days.flatMap((_, index) => {
    const signal = index < reactiveCount ? rankedSignals[index] : undefined
    return signal ? [pillarFor(signal, persona.pillars)] : []
  })
  const counts = { ...args.priorCounts }
  for (const pillar of reactivePillars) counts[pillar] = (counts[pillar] ?? 0) + 1
  const evergreen = allocatePillars(args.pillarWeights, counts, days.length - reactivePillars.length)

  return days.map((day, index) => {
    const signal = index < reactiveCount ? rankedSignals[index] : undefined
    const pillar = signal ? pillarFor(signal, persona.pillars) : evergreen[index - reactivePillars.length]
    if (pillar === undefined) throw new Error(`slot ${index} of the week has no pillar`)
    const concept = signal ? signalConcept(signal.title) : `${pillar}: an evergreen how-to`
    const sponsorSegment: SponsorSegment = sponsoredSlots.has(index) ? (index % 2 === 0 ? 'demo' : 'mention') : 'none'

    // Only a sponsored episode places a sponsor, so a sponsor experiment tests only those.
    const takesVariant = args.experiment !== undefined && (args.experiment.kind !== 'sponsor' || sponsorSegment !== 'none')
    const variantKey = args.experiment && takesVariant ? leastAssigned(args.experiment.variantKeys, assigned) : undefined
    if (variantKey) assigned[variantKey] = (assigned[variantKey] ?? 0) + 1

    return {
      plannedFor: day,
      pillar,
      signalId: signal?.id,
      concept,
      sponsorSegment,
      experimentId: variantKey === undefined ? undefined : args.experiment?.id,
      variantKey,
    }
  })
}

/**
 * What a post slot sets out to do, how long it runs, and the kind of post
 * that length takes; a single post in a post kind experiment carries its
 * variant.
 */
export interface PostShape {
  intent: PostIntent
  length: PostLength
  kind: PostKind
  experimentId?: string
  variantKey?: string
}

/** One post slot of the plan: a day, its hour on X, what it is about, and its shape. */
export interface PlannedPost extends Omit<PlannedEpisode, 'experimentId' | 'variantKey'>, PostShape {
  hour: number
}

/**
 * How the week's single posts get their kind (the post kind dimension): the
 * variant in force for every one of them (the persona's default, else the
 * catalog's control, rotate), or, while a post kind experiment runs, its
 * variants per post, balanced by the posts each already has. A thread's kind
 * follows its length, so a thread carries no variant.
 */
export type PostKindPlan =
  | { mode: 'default'; key: PostKindVariantKey }
  | { mode: 'experiment'; id: string; variantKeys: PostKindVariantKey[]; assigned: Record<string, number> }

/**
 * The post slots of a persona with an X format: every day of the week at the
 * hours of its cadence (postSlotHours), skipping a day that already holds
 * posts and any hour already gone. The slots are shaped in time order
 * (shapePostSlots), from the voice's length mix once the analyst has learned
 * it, so a new week carries on where the last one stopped.
 *
 * Concepts, pillars and the sponsor follow the same rule as the video slots:
 * planWeek plans one slot per day, so it runs once per slot hour with every
 * open day free. The pillar weights are the persona's, and the posts each
 * pillar had in the last PILLAR_HISTORY_DAYS days, plus the slots of the
 * hours already planned, count toward its share. A post shows no screen, so a
 * sponsored post mentions the sponsor where a video would demo it.
 */
export function planPostSlots(args: {
  weekStart: string
  persona: Pick<Doc<'personas'>, 'pillars' | 'sponsorDial' | 'sponsorRampEpisodes' | 'timezone' | 'voice' | 'strategy'>
  format: PlatformFormat
  /** The persona's live posts. */
  posts: Pick<Doc<'episodes'>, 'plannedFor' | 'kind' | 'pillar'>[]
  /** Every live episode of the persona plus the videos planned this run, for the sponsor ramp. */
  episodeCount: number
  /** Signals no video took. */
  signals: PlannerSignal[]
  postKinds: PostKindPlan
  now: number
}): PlannedPost[] {
  const cadence = args.format.cadence
  if (!cadence) throw new Error('an X format without a post cadence cannot plan posts')
  if (cadence.kinds.length === 0) throw new Error('an X cadence without post kinds cannot plan posts')
  const week = Array.from({ length: 7 }, (_, offset) => addDays(args.weekStart, offset))
  const open = (day: string, hour: number) =>
    !args.posts.some((post) => post.plannedFor === day) && instantAt(day, hour, args.persona.timezone) > args.now
  const slots: Omit<PlannedPost, keyof PostShape>[] = []
  let signals = args.signals
  const weights = pillarWeights(args.persona.pillars, args.persona.strategy?.pillarWeights)
  const since = addDays(dayKey(args.now, args.persona.timezone), -PILLAR_HISTORY_DAYS)
  const counts: Record<string, number> = {}
  for (const post of args.posts) {
    if (post.pillar === undefined || post.plannedFor < since) continue
    counts[post.pillar] = (counts[post.pillar] ?? 0) + 1
  }
  for (const hour of postSlotHours(args.format)) {
    const row = planWeek({
      weekStart: args.weekStart,
      persona: {
        pillars: args.persona.pillars,
        sponsorDial: args.persona.sponsorDial,
        sponsorRampEpisodes: args.persona.sponsorRampEpisodes,
        episodesPerWeek: week.length,
        episodeCount: args.episodeCount + slots.length,
      },
      pillarWeights: weights,
      priorCounts: { ...counts },
      signals,
      takenDays: week.filter((day) => !open(day, hour)),
    })
    for (const planned of row) {
      counts[planned.pillar] = (counts[planned.pillar] ?? 0) + 1
      slots.push({
        plannedFor: planned.plannedFor,
        hour,
        pillar: planned.pillar,
        signalId: planned.signalId,
        concept: planned.concept,
        sponsorSegment: planned.sponsorSegment === 'none' ? 'none' : 'mention',
      })
    }
    const taken = new Set(row.map((planned) => planned.signalId))
    signals = signals.filter((signal) => !taken.has(signal.id))
  }
  slots.sort((a, b) => a.plannedFor.localeCompare(b.plannedFor) || a.hour - b.hour)
  const shapes = shapePostSlots({
    cadence,
    // Before the analyst learns the account's voice, the week follows the default mix.
    lengthMix: args.persona.voice?.lengthMix ?? DEFAULT_LENGTH_MIX,
    count: slots.length,
    postsSoFar: args.posts.length,
    singlesSoFar: args.posts.filter((post) => post.kind !== 'thread').length,
    postKinds: args.postKinds,
  })
  return slots.map((slot, index) => {
    const shape = shapes[index]
    if (!shape) throw new Error(`post slot ${index} has no shape`)
    return { ...slot, ...shape }
  })
}

/**
 * What each new post slot sets out to do and how long it runs, in time
 * order (docs/plan.md, slice 5). Intents rotate through the cadence's and
 * carry on from the posts the persona already has, across days and weeks.
 * Lengths come from the length mix (shared `pickLengths`). The kind follows
 * the length: a long slot is a thread when the cadence has threads and a full
 * post when it does not, and one-liners and full posts take the kind the post
 * kind plan gives them: the next of the cadence's other kinds under rotate, or
 * the one kind a variant names. The cadence is the operator's, so a kind it
 * lacks is never planned: under such a variant the post rotates. A cadence of
 * threads alone cannot honor a short or full post, so every slot there is a
 * thread.
 */
function shapePostSlots(args: {
  cadence: XCadence
  lengthMix: LengthMix
  count: number
  /** The persona's live posts, for the intent rotation. */
  postsSoFar: number
  /** The persona's live text and image posts, for the kind rotation. */
  singlesSoFar: number
  postKinds: PostKindPlan
}): PostShape[] {
  const { intents, kinds } = args.cadence
  if (intents.length === 0) throw new Error('an X cadence without post intents cannot plan posts')
  const singles = kinds.filter((kind) => kind !== 'thread')
  const threads = kinds.includes('thread')
  const plan = args.postKinds
  const assigned = plan.mode === 'experiment' ? { ...plan.assigned } : {}
  let single = args.singlesSoFar
  return pickLengths(args.lengthMix, args.count).map((picked, index): PostShape => {
    const intent = intents[(args.postsSoFar + index) % intents.length]
    if (intent === undefined) throw new Error('intent rotation out of range')
    if (singles.length === 0 || (picked === 'long' && threads)) return { intent, length: 'long', kind: 'thread' }
    const rotated = singles[single % singles.length]
    if (rotated === undefined) throw new Error('kind rotation out of range')
    single += 1
    const length = picked === 'long' ? 'medium' : picked
    const kindOf = (key: PostKindVariantKey): PostKind => (key === 'rotate' || !singles.includes(key) ? rotated : key)
    if (plan.mode === 'default') return { intent, length, kind: kindOf(plan.key) }
    const variantKey = leastAssigned(plan.variantKeys, assigned)
    assigned[variantKey] = (assigned[variantKey] ?? 0) + 1
    return { intent, length, kind: kindOf(variantKey), experimentId: plan.id, variantKey }
  })
}

/** Which slots of the week carry the sponsor, honoring the ramp and the dial. */
function sponsoredSlotIndexes(slots: number, persona: PlannerPersona): Set<number> {
  const out = new Set<number>()
  const rampLeft = Math.max(0, persona.sponsorRampEpisodes - persona.episodeCount)
  const eligible = Math.max(0, slots - rampLeft)
  const wanted = Math.round(eligible * Math.min(1, Math.max(0, persona.sponsorDial)))
  // Spread sponsored episodes from the end of the week backwards so the ramp
  // (which covers the first slots) and the sponsor never collide.
  for (let i = 0; i < wanted; i += 1) {
    const step = eligible / wanted
    out.add(slots - 1 - Math.floor(i * step))
  }
  return out
}

function pillarFor(signal: PlannerSignal, pillars: string[]): string {
  const lowerTopics = signal.topics.map((topic) => topic.toLowerCase())
  const match = pillars.find((pillar) =>
    lowerTopics.some((topic) => pillar.toLowerCase().includes(topic) || topic.includes(pillar.toLowerCase()))
  )
  return match ?? pillars[0] ?? ''
}
