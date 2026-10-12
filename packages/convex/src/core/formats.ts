import { LENGTH_SEC_MAX, LENGTH_SEC_MIN, PLATFORM_LABELS, PLATFORMS, type Platform, type PlatformFormat } from '@influstep/shared'
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

/** The first publish instant of an episode on `day`: the earliest publish hour among its platforms. */
export function earliestPublishAt(persona: FormatOwner & Pick<Doc<'personas'>, 'timezone'>, platforms: Platform[], day: string): number {
  const instants = formatsFor(persona, platforms).map((format) => instantAt(day, format.publishHour, persona.timezone))
  if (instants.length === 0) throw new Error('an episode needs at least one platform')
  return Math.min(...instants)
}

/** What personas.create and update accept: at least one platform, each once, every value in range. */
export function assertFormats(formats: PlatformFormat[]): void {
  if (formats.length === 0) throw refusal('A persona needs at least one platform.')
  const seen = new Set<Platform>()
  for (const format of formats) {
    if (seen.has(format.platform)) throw refusal(`${PLATFORM_LABELS[format.platform]} has two formats.`)
    seen.add(format.platform)
    if (!Number.isInteger(format.lengthSec) || format.lengthSec < LENGTH_SEC_MIN || format.lengthSec > LENGTH_SEC_MAX) {
      throw refusal(`${PLATFORM_LABELS[format.platform]}: the length is ${LENGTH_SEC_MIN} to ${LENGTH_SEC_MAX} seconds.`)
    }
    if (!Number.isInteger(format.publishHour) || format.publishHour < 0 || format.publishHour > 23) {
      throw refusal(`${PLATFORM_LABELS[format.platform]}: the publish hour is 0 to 23.`)
    }
    if (format.hookNote.trim().length === 0) throw refusal(`${PLATFORM_LABELS[format.platform]}: the hook note is empty.`)
  }
}
