import { postSlotHours, type PlatformFormat, type PostKind, type SponsorSegment } from '@influstep/shared'
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

/** One post slot of the plan: a day, its hour on X, the kind it takes, and what it is about. */
export interface PlannedPost extends Omit<PlannedEpisode, 'experimentId' | 'variantKey'> {
  hour: number
  kind: PostKind
}

/**
 * The post slots of a persona with an X format: every day of the week at the
 * hours of its cadence (postSlotHours), skipping a day that already holds
 * posts and any hour already gone. Kinds rotate through the cadence in time
 * order and carry on from the posts the persona already has, so a new week
 * continues where the last one stopped.
 *
 * Concepts, pillars and the sponsor follow the same rule as the video slots:
 * planWeek plans one slot per day, so it runs once per slot hour with every
 * open day free. A post shows no screen, so a sponsored post mentions the
 * sponsor where a video would demo it.
 */
export function planPostSlots(args: {
  weekStart: string
  persona: Pick<Doc<'personas'>, 'pillars' | 'sponsorDial' | 'sponsorRampEpisodes' | 'timezone'>
  format: PlatformFormat
  /** The persona's live posts. */
  posts: Pick<Doc<'episodes'>, 'plannedFor'>[]
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
  const slots: Omit<PlannedPost, 'kind'>[] = []
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
  return slots.map((slot, index) => ({ ...slot, kind: cadence.kinds[(args.posts.length + index) % cadence.kinds.length] }))
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
