import {
  DEFAULT_LENGTH_MIX,
  pickLengths,
  postSlotHours,
  type LengthMix,
  type PlatformFormat,
  type PostIntent,
  type PostKind,
  type PostLength,
  type SponsorSegment,
  type XCadence,
} from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import { addDays, instantAt } from './dates'

/**
 * The weekly plan (CONTEXT.md, "Plan"): which days get an episode, which of
 * those carry the sponsor, which pillar or signal each draws from, and which
 * experiment variant it is assigned. Pure, so the rules are testable without
 * a database; the writer's plan_week job feeds it rows and stores the output.
 */

export interface PlannerPersona {
  pillars: string[]
  sponsorDial: number
  sponsorRampEpisodes: number
  episodesPerWeek: number
  /** Episodes this persona has planned so far, for the ramp and pillar rotation. */
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

/** Weekday slots by cadence: spread across the week, weekends last. */
const SLOT_ORDER = [1, 3, 5, 2, 4, 0, 6] // Tue, Thu, Sat, Wed, Fri, Mon, Sun offsets from Monday

export function planWeek(args: {
  weekStart: string
  persona: PlannerPersona
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

  const rankedSignals = [...args.signals].sort((a, b) => b.score - a.score)
  // Two of five reactive, the rest evergreen (docs/plan.md, idea 7).
  const reactiveCount = Math.min(rankedSignals.length, Math.max(1, Math.round(days.length * 0.4)))

  const sponsoredSlots = sponsoredSlotIndexes(days.length, persona)
  const assigned = { ...args.experiment?.assigned }

  return days.map((day, index) => {
    const signal = index < reactiveCount ? rankedSignals[index] : undefined
    const pillarIndex = (persona.episodeCount + index) % persona.pillars.length
    const pillar = signal ? pillarFor(signal, persona.pillars) : (persona.pillars[pillarIndex] ?? persona.pillars[0] ?? '')
    const concept = signal ? `React to: ${signal.title}` : `${pillar}: an evergreen how-to`
    const sponsorSegment: SponsorSegment = sponsoredSlots.has(index) ? (index % 2 === 0 ? 'demo' : 'mention') : 'none'

    const variantKey = args.experiment ? pickVariant(args.experiment.variantKeys, assigned) : undefined
    if (variantKey) assigned[variantKey] = (assigned[variantKey] ?? 0) + 1

    return {
      plannedFor: day,
      pillar,
      signalId: signal?.id,
      concept,
      sponsorSegment,
      experimentId: args.experiment?.id,
      variantKey,
    }
  })
}

/** What a post slot sets out to do, how long it runs, and the kind of post that length takes. */
export interface PostShape {
  intent: PostIntent
  length: PostLength
  kind: PostKind
}

/** One post slot of the plan: a day, its hour on X, what it is about, and its shape. */
export interface PlannedPost extends Omit<PlannedEpisode, 'experimentId' | 'variantKey'>, PostShape {
  hour: number
}

/**
 * The post slots of a persona with an X format: every day of the week at the
 * hours of its cadence (postSlotHours), skipping a day that already holds
 * posts and any hour already gone. The slots are shaped in time order
 * (shapePostSlots), from the voice's length mix once the analyst has learned
 * it, so a new week carries on where the last one stopped.
 *
 * Concepts, pillars and the sponsor follow the same rule as the video slots:
 * planWeek plans one slot per day, so it runs once per slot hour with every
 * open day free. A post shows no screen, so a sponsored post mentions the
 * sponsor where a video would demo it.
 */
export function planPostSlots(args: {
  weekStart: string
  persona: Pick<Doc<'personas'>, 'pillars' | 'sponsorDial' | 'sponsorRampEpisodes' | 'timezone' | 'voice'>
  format: PlatformFormat
  /** The persona's live posts. */
  posts: Pick<Doc<'episodes'>, 'plannedFor' | 'kind'>[]
  /** Every live episode of the persona plus the videos planned this run, for the sponsor ramp and the pillar rotation. */
  episodeCount: number
  /** Signals no video took. */
  signals: PlannerSignal[]
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
      signals,
      takenDays: week.filter((day) => !open(day, hour)),
    })
    for (const planned of row) {
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
 * post when it does not, and one-liners and full posts rotate through the
 * cadence's other kinds. A cadence of threads alone cannot honor a short or
 * full post, so every slot there is a thread.
 */
function shapePostSlots(args: {
  cadence: XCadence
  lengthMix: LengthMix
  count: number
  /** The persona's live posts, for the intent rotation. */
  postsSoFar: number
  /** The persona's live text and image posts, for the kind rotation. */
  singlesSoFar: number
}): PostShape[] {
  const { intents, kinds } = args.cadence
  if (intents.length === 0) throw new Error('an X cadence without post intents cannot plan posts')
  const singles = kinds.filter((kind) => kind !== 'thread')
  const threads = kinds.includes('thread')
  let single = args.singlesSoFar
  return pickLengths(args.lengthMix, args.count).map((picked, index): PostShape => {
    const intent = intents[(args.postsSoFar + index) % intents.length]
    if (intent === undefined) throw new Error('intent rotation out of range')
    if (singles.length === 0 || (picked === 'long' && threads)) return { intent, length: 'long', kind: 'thread' }
    const kind = singles[single % singles.length]
    if (kind === undefined) throw new Error('kind rotation out of range')
    single += 1
    return { intent, length: picked === 'long' ? 'medium' : picked, kind }
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

function pickVariant(keys: string[], assigned: Record<string, number>): string | undefined {
  let best: string | undefined
  let bestCount = Number.POSITIVE_INFINITY
  for (const key of keys) {
    const count = assigned[key] ?? 0
    if (count < bestCount) {
      best = key
      bestCount = count
    }
  }
  return best
}
