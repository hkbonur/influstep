import type { AssetKind } from './assets'
import type { PlatformFormat } from './formats'

/**
 * A persona's look (docs/plan.md, slice 13): the presenter style its avatar
 * takes are made in, and the reference images or clips in its asset library
 * the avatar provider reads for every take. A persona with no presenter
 * shows the screen and speaks over it.
 */
export const APPEARANCE_STYLES = ['cartoon', 'photoreal', 'voice_only'] as const
export type AppearanceStyle = (typeof APPEARANCE_STYLES)[number]

export const APPEARANCE_STYLE_LABELS: Record<AppearanceStyle, string> = {
  cartoon: 'Cartoon presenter',
  photoreal: 'Photoreal presenter',
  voice_only: 'Screen only, with a voice',
}

export const APPEARANCE_STYLE_HINTS: Record<AppearanceStyle, string> = {
  cartoon: 'A drawn character on camera, or in a corner of the screen, Loom-style.',
  photoreal: 'A realistic person on camera, or in a corner of the screen, Loom-style. Always labelled as AI-generated.',
  voice_only: 'No presenter: the screen, and the voice over it.',
}

/** At most this many reference files per persona. */
export const REFERENCES_MAX = 4

/** What a reference can be: pictures of the look, or a short clip of it. */
export const REFERENCE_KINDS = ['image', 'clip'] as const satisfies readonly AssetKind[]

/** The asset library tag every reference carries, so the operator finds them among the persona's assets. */
export const REFERENCE_TAG = 'reference'

export function isReferenceKind(kind: AssetKind): kind is (typeof REFERENCE_KINDS)[number] {
  return REFERENCE_KINDS.some((candidate) => candidate === kind)
}

/**
 * Why a look and a set of formats cannot go together: a persona with no
 * presenter has no avatar takes, so every platform it publishes on records
 * the screen only.
 */
export function appearanceProblem(style: AppearanceStyle, formats: readonly Pick<PlatformFormat, 'delivery'>[]): string | null {
  if (style !== 'voice_only') return null
  if (formats.every((format) => format.delivery === 'screen_only')) return null
  return 'A persona with no presenter records the screen only: set every platform to Screen only, or pick a presenter.'
}

/** How long a voice description runs: long enough to say who speaks, short enough for the voice provider. */
export const VOICE_DESCRIPTION_MIN = 20
export const VOICE_DESCRIPTION_MAX = 1000

export function voiceDescriptionProblem(description: string): string | null {
  const length = description.trim().length
  if (length < VOICE_DESCRIPTION_MIN)
    return `Describe the voice in at least ${VOICE_DESCRIPTION_MIN} characters: who speaks, how old, the accent, the pace.`
  if (length > VOICE_DESCRIPTION_MAX) return `Keep the voice description within ${VOICE_DESCRIPTION_MAX} characters.`
  return null
}
