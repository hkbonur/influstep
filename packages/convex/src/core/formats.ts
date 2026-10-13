import {
  CADENCE_POSTS_MAX,
  CADENCE_POSTS_MIN,
  EPISODE_KIND_LABELS,
  LENGTH_SEC_MAX,
  LENGTH_SEC_MIN,
  PLATFORM_LABELS,
  PLATFORMS,
  REPLIES_PER_DAY_MAX,
  REPLIES_PER_DAY_MIN,
  type EffectiveVariant,
  type Platform,
  type PlatformFormat,
  type PostKind,
  type XCadence,
} from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import { instantAt } from './dates'
import { refusal } from '../lib/errors'

/**
 * A persona publishes only where it has a format (docs/plan.md, "Platform
 * specialists"). Everything that asks "which platforms" or "what hour" reads
 * the persona's formats through here.
 */

type FormatOwner = Pick<Doc<'personas'>, 'formats'>

export function platformsOf(persona: FormatOwner): Platform[] {
  return persona.formats.map((format) => format.platform)
}

/** The persona's format for one platform. A platform the persona lacks is an error that names it. */
export function formatFor(persona: FormatOwner, platform: Platform): PlatformFormat {
  const format = persona.formats.find((candidate) => candidate.platform === platform)
  if (!format) throw refusal(`The persona does not publish on ${PLATFORM_LABELS[platform]}.`)
  return format
}

/** The persona's formats for these platforms, in PLATFORMS order. */
export function formatsFor(persona: FormatOwner, platforms: Platform[]): PlatformFormat[] {
  return PLATFORMS.filter((platform) => platforms.includes(platform)).map((platform) => formatFor(persona, platform))
}

/**
 * How many hours a video's publications move from each platform's usual hour:
 * the hour offset of its publish time variant (shared `effectiveVariant` over
 * 'publish_time'). No publish time default is ever stored, since a decided
 * test moves `formats[].publishHour` itself, so anything but the episode's own
 * variant reads 0.
 */
export function publishOffset(variant: EffectiveVariant | undefined): number {
  if (variant === undefined) return 0
  if (variant.kind !== 'publish_time') throw new Error(`a ${variant.kind} variant moves no publish hour`)
  return variant.hourOffset ?? 0
}

/**
 * The hour a video goes out on a platform: the format's hour moved by the
 * offset, kept within the day so a publication never changes day. A video's X
 * publication keeps X's own hour, as posts keep their slots: publish time is
 * tested on the video platforms only. The one place a video's publish hour is
 * computed.
 */
export function publishHourFor(format: Pick<PlatformFormat, 'platform' | 'publishHour'>, offset: number): number {
  if (format.platform === 'x') return format.publishHour
  return Math.min(23, Math.max(0, format.publishHour + offset))
}

/**
 * The first publish instant of an episode on `day`: the earliest publish hour
 * among its platforms, each moved by the episode's publish offset.
 */
export function earliestPublishAt(
  persona: FormatOwner & Pick<Doc<'personas'>, 'timezone'>,
  platforms: Platform[],
  day: string,
  offset: number
): number {
  const instants = formatsFor(persona, platforms).map((format) => instantAt(day, publishHourFor(format, offset), persona.timezone))
  if (instants.length === 0) throw new Error('an episode needs at least one platform')
  return Math.min(...instants)
}

/**
 * What personas.create and update accept: at least one platform, each once,
 * every value in range, and a post cadence on X and nowhere else, with each
 * post kind and each post intent at most once and neither list empty, and a
 * reply budget in range.
 */
export function assertFormats(formats: PlatformFormat[]): void {
  if (formats.length === 0) throw refusal('A persona needs at least one platform.')
  const seen = new Set<Platform>()
  for (const format of formats) {
    const label = PLATFORM_LABELS[format.platform]
    if (seen.has(format.platform)) throw refusal(`${label} has two formats.`)
    seen.add(format.platform)
    if (!Number.isInteger(format.lengthSec) || format.lengthSec < LENGTH_SEC_MIN || format.lengthSec > LENGTH_SEC_MAX) {
      throw refusal(`${label}: the length is ${LENGTH_SEC_MIN} to ${LENGTH_SEC_MAX} seconds.`)
    }
    if (!Number.isInteger(format.publishHour) || format.publishHour < 0 || format.publishHour > 23) {
      throw refusal(`${label}: the publish hour is 0 to 23.`)
    }
    if (format.hookNote.trim().length === 0) throw refusal(`${label}: the hook note is empty.`)
    if (format.platform !== 'x') {
      if (format.cadence) throw refusal(`${label} has no post cadence; only X does.`)
      continue
    }
    if (!format.cadence) throw refusal('X needs a post cadence.')
    assertCadence(format.cadence)
  }
}

function assertCadence(cadence: XCadence): void {
  const { postsPerDay, kinds, intents, repliesPerDay } = cadence
  if (!Number.isInteger(postsPerDay) || postsPerDay < CADENCE_POSTS_MIN || postsPerDay > CADENCE_POSTS_MAX) {
    throw refusal(`X: posts per day is ${CADENCE_POSTS_MIN} to ${CADENCE_POSTS_MAX}.`)
  }
  if (kinds.length === 0) throw refusal('X: pick at least one post kind.')
  const picked = new Set<PostKind>()
  for (const kind of kinds) {
    if (picked.has(kind)) throw refusal(`X: ${EPISODE_KIND_LABELS[kind]} is picked twice.`)
    picked.add(kind)
  }
  // The planner rotates through the intents in order, so a repeated one would only skew the mix.
  if (intents.length === 0) throw refusal('X: pick at least one post intent.')
  if (new Set(intents).size !== intents.length) throw refusal('X: each post intent once.')
  if (!Number.isInteger(repliesPerDay) || repliesPerDay < REPLIES_PER_DAY_MIN || repliesPerDay > REPLIES_PER_DAY_MAX) {
    throw refusal(`X: replies per day is ${REPLIES_PER_DAY_MIN} to ${REPLIES_PER_DAY_MAX}.`)
  }
}
