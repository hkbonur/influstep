import type { AssetKind } from './assets'
import type { Delivery, PlatformFormat } from './formats'

/**
 * A persona's look (docs/plan.md, slice 13): the presenter style its avatar
 * takes are made in, and the reference images or clips in its asset library
 * the avatar provider reads for every take. A persona with no presenter
 * shows the screen and speaks over it.
 */
export const APPEARANCE_STYLES = ['cartoon', 'photoreal', 'loom', 'voice_only'] as const
export type AppearanceStyle = (typeof APPEARANCE_STYLES)[number]

export const APPEARANCE_STYLE_LABELS: Record<AppearanceStyle, string> = {
  cartoon: 'Cartoon presenter',
  photoreal: 'Photoreal presenter',
  loom: 'Loom-style presenter',
  voice_only: 'Screen only, with a voice',
}

export const APPEARANCE_STYLE_HINTS: Record<AppearanceStyle, string> = {
  cartoon: 'A drawn character on camera, or opening a screen recording.',
  photoreal: 'A realistic person on camera, or opening a screen recording. Always labelled as AI-generated.',
  loom: 'The screen the whole time, with the presenter in a small round bubble in a corner, like a Loom recording. Its face is drawn or realistic, as you pick.',
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
  if (style === 'voice_only') {
    if (formats.every((format) => format.delivery === 'screen_only')) return null
    return 'A persona with no presenter records the screen only: set every platform to Screen only, or pick a presenter.'
  }
  if (style === 'loom') {
    if (formats.every((format) => format.delivery === 'screen_with_avatar')) return null
    return 'A Loom-style persona records the screen with its presenter in a bubble: set every platform to Screen with avatar, or pick another look.'
  }
  return null
}

/** The delivery a look records every platform in, when it holds them to one; none when any delivery fits it. */
export function deliveryOfStyle(style: AppearanceStyle): Delivery | null {
  if (style === 'voice_only') return 'screen_only'
  if (style === 'loom') return 'screen_with_avatar'
  return null
}

/** A look with a presenter has a face, which every avatar take is made from. */
export function hasPresenter(style: AppearanceStyle): boolean {
  return style !== 'voice_only'
}

/** How a presenter's face is drawn: the cartoon and photoreal looks say it, a Loom-style look leaves it to the operator. */
export const PRESENTER_FACES = ['cartoon', 'photoreal'] as const
export type PresenterFace = (typeof PRESENTER_FACES)[number]

export const PRESENTER_FACE_LABELS: Record<PresenterFace, string> = { cartoon: 'Cartoon', photoreal: 'Realistic' }

/** A look as it is stored: a Loom-style look carries the face the operator picked, no other look has one. */
export interface Appearance {
  style: AppearanceStyle
  face?: PresenterFace
}

/**
 * The face a look's presenter has; none without a presenter. A Loom-style
 * look without its face is a bug: the look is only stored with one
 * (`appearanceFaceProblem`).
 */
export function presenterFace(appearance: Appearance): PresenterFace | null {
  if (appearance.style === 'voice_only') return null
  if (appearance.style === 'loom') {
    if (appearance.face === undefined) throw new Error('a Loom-style look is stored without its face')
    return appearance.face
  }
  return appearance.style
}

/** Why a look's face cannot be stored: a Loom-style look needs one, and only it has one. */
export function appearanceFaceProblem(appearance: Appearance): string | null {
  if (appearance.style === 'loom' && appearance.face === undefined)
    return 'Pick whether the Loom-style presenter is a cartoon or realistic.'
  if (appearance.style !== 'loom' && appearance.face !== undefined)
    return `A ${APPEARANCE_STYLE_LABELS[appearance.style].toLowerCase()} has no face to pick.`
  return null
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
