import type { PostKind } from './episode-kinds'
import { POST_INTENTS, type PostIntent } from './post-mix'
import { PLATFORMS, PLATFORM_ASPECT, type AspectRatio, type Platform } from './platforms'
import { REPLIES_PER_DAY_DEFAULT } from './replies'

/**
 * How a persona produces for one platform (docs/plan.md, "Platform
 * specialists"): how long, which cut, whether a presenter or a screen is on
 * camera, how the hook opens, and the local hour it goes out.
 */

export const DELIVERIES = ['talking_head', 'screen_with_avatar', 'screen_only'] as const
export type Delivery = (typeof DELIVERIES)[number]

export const DELIVERY_LABELS: Record<Delivery, string> = {
  talking_head: 'Talking head',
  screen_with_avatar: 'Screen with avatar',
  screen_only: 'Screen only',
}

/**
 * How often an X persona posts without a video, which kinds of post it
 * writes, which intents the planner rotates through, and how many replies it
 * sends a day. Only X has one.
 */
export interface XCadence {
  /** Posts a day, CADENCE_POSTS_MIN to CADENCE_POSTS_MAX, three hours apart from the publish hour. */
  postsPerDay: number
  /** Each kind at most once, never empty. */
  kinds: PostKind[]
  /** Each intent at most once, never empty. */
  intents: PostIntent[]
  /** The daily reply budget, REPLIES_PER_DAY_MIN to REPLIES_PER_DAY_MAX (shared replies.ts); zero turns listening off. */
  repliesPerDay: number
}

export const CADENCE_POSTS_MIN = 1
export const CADENCE_POSTS_MAX = 4

export interface PlatformFormat {
  platform: Platform
  /** Target spoken length, 10 to 1200 seconds. */
  lengthSec: number
  aspect: AspectRatio
  delivery: Delivery
  /** The hook convention the writer follows on this platform. Never empty. */
  hookNote: string
  /** Local hour (0 to 23) publications on this platform default to. */
  publishHour: number
  /** Present if and only if the platform is X (core/formats.ts refuses anything else). */
  cadence?: XCadence
}

export const LENGTH_SEC_MIN = 10
export const LENGTH_SEC_MAX = 1200

/** What a new persona starts from; the operator edits each one. */
export const DEFAULT_FORMATS: Record<Platform, Omit<PlatformFormat, 'platform'>> = {
  youtube: {
    lengthSec: 300,
    aspect: PLATFORM_ASPECT.youtube,
    delivery: 'screen_with_avatar',
    hookNote: 'Say the outcome in the first sentence, then show the screen. Chapters in the description.',
    publishHour: 16,
  },
  tiktok: {
    lengthSec: 35,
    aspect: PLATFORM_ASPECT.tiktok,
    delivery: 'talking_head',
    hookNote: 'Hook in the first two seconds. One idea. End on the next step.',
    publishHour: 18,
  },
  instagram: {
    lengthSec: 45,
    aspect: PLATFORM_ASPECT.instagram,
    delivery: 'talking_head',
    hookNote: 'Open on the problem, show the fix, ask one question at the end.',
    publishHour: 12,
  },
  x: {
    lengthSec: 60,
    aspect: PLATFORM_ASPECT.x,
    delivery: 'talking_head',
    hookNote: 'Put the point in the first line; the video proves it.',
    publishHour: 15,
    cadence: { postsPerDay: 2, kinds: ['text', 'image', 'thread'], intents: [...POST_INTENTS], repliesPerDay: REPLIES_PER_DAY_DEFAULT },
  },
}

/** One platform the episode goes to and the cut it takes there, frozen with the format. */
export interface EpisodeCut {
  platform: Platform
  aspect: AspectRatio
}

/**
 * The format one episode is written and produced to, stored on the episode
 * when it is scripted and again when its platforms change. The cuts are the
 * episode's own, so a later aspect change in the persona's settings does not
 * queue a publication for a render that was never made.
 */
export interface EpisodeFormat {
  lengthSec: number
  delivery: Delivery
  /** One per platform the episode goes to, in PLATFORMS order. */
  cuts: EpisodeCut[]
}

/**
 * One script for every platform the episode goes to: short enough for the
 * shortest target, produced the way the longest-form platform needs (a tie
 * goes to the first platform in PLATFORMS order), with one cut per platform
 * in PLATFORMS order.
 */
export function resolveEpisodeFormat(formats: PlatformFormat[]): EpisodeFormat {
  const ordered = PLATFORMS.flatMap((platform) => formats.filter((format) => format.platform === platform))
  const [first] = ordered
  if (!first) throw new Error('an episode needs at least one platform format')
  let shortest = first
  let longest = first
  for (const format of ordered) {
    if (format.lengthSec < shortest.lengthSec) shortest = format
    if (format.lengthSec > longest.lengthSec) longest = format
  }
  return {
    lengthSec: shortest.lengthSec,
    delivery: longest.delivery,
    cuts: ordered.map((format) => ({ platform: format.platform, aspect: format.aspect })),
  }
}

/** The aspects the producer renders: each once, in cuts order. */
export function formatAspects(format: EpisodeFormat): AspectRatio[] {
  return [...new Set(format.cuts.map((cut) => cut.aspect))]
}

/** "35 s" under a minute and a half, otherwise minutes with one decimal only when it is not whole: "4 min", "4.5 min". */
export function formatLength(lengthSec: number): string {
  if (lengthSec < 90) return `${lengthSec} s`
  const minutes = Math.round(lengthSec / 6) / 10
  return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1)} min`
}
