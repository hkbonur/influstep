import { presenterFace, type Appearance } from './appearance'
import type { PersonaColor } from './persona-colors'

/**
 * Generated media (docs/plan.md, slice 15): the stills and short clips the
 * producer makes from a prompt where a beat would otherwise show an asset,
 * or the operator asks for on the Assets page. Nothing generated pretends to
 * be real, and each persona has a daily budget.
 */
export const MEDIA_KINDS = ['image', 'clip'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = { image: 'Image', clip: 'Clip' }

/** How long a generated clip runs; a beat longer than it loops the clip. */
export const CLIP_SECONDS = 5

/** What a persona may generate in one of its days. */
export const MEDIA_BUDGET = { images: 12, clipSeconds: 30 } as const

export const GENERATION_STATUSES = ['queued', 'running', 'done', 'failed'] as const
export type GenerationStatus = (typeof GENERATION_STATUSES)[number]

/** The tag every generated asset carries, so the operator finds them among the producer's. */
export const GENERATED_TAG = 'generated'

export const PROMPT_MAX = 400

/**
 * Brands and products a prompt may not name, since a picture of them would be
 * made up: a real product's screen is recorded, never generated. The sponsor
 * is the one brand a prompt may name, and only outside its demo beat, where
 * its real screen shows.
 */
const OTHER_BRANDS = [
  'n8n',
  'zapier',
  'make.com',
  'notion',
  'figma',
  'slack',
  'airtable',
  'google',
  'gmail',
  'microsoft',
  'excel',
  'outlook',
  'apple',
  'openai',
  'chatgpt',
  'claude',
  'anthropic',
  'github',
  'stripe',
  'hubspot',
  'salesforce',
  'shopify',
  'typeform',
  'jotform',
  'tally',
  'linear',
  'jira',
  'trello',
  'asana',
  'youtube',
  'tiktok',
  'instagram',
  'twitter',
  'facebook',
  'whatsapp',
  'docusign',
] as const

const SCREENSHOT = /\b(screen ?shots?|screen recordings?|screen captures?|screencasts?)\b/i
// "a photo of Jane Doe", "featuring John Smith": a picture of someone by name.
const NAMED_PERSON = /\b(?:of|with|featuring|starring|like|as)\s+(?:[A-Z][a-z]+)\s+(?:[A-Z][a-z]+)\b/
const REAL_PERSON = /\b(celebrity|celebrities|famous (?:person|people)|real person|real people|politician|the (?:ceo|founder) of)\b/i

/**
 * Why a prompt cannot be generated, in the operator's and the writer's
 * words; none when it can. A real person, a brand other than the sponsor,
 * or a real product's screen is refused: a picture a model made up would
 * mislead a viewer about who said something or how a tool works.
 */
export function generationPromptProblem(prompt: string, sponsorName: string): string | null {
  const text = prompt.trim()
  if (text.length === 0) return 'Say what the picture shows.'
  if (text.length > PROMPT_MAX) return `Keep the prompt within ${PROMPT_MAX} characters.`
  const lower = text.toLowerCase()
  const brand = OTHER_BRANDS.find(
    (name) => name !== sponsorName.toLowerCase() && new RegExp(`(^|[^a-z0-9])${name.replace('.', '\\.')}([^a-z0-9]|$)`).test(lower)
  )
  if (brand)
    return `The prompt names ${brand}, a brand other than ${sponsorName}: a made-up picture of it would mislead. Record its real screen instead.`
  if (SCREENSHOT.test(text)) return 'A screenshot claims to be real, so it is recorded, never generated. Describe a picture instead.'
  if (NAMED_PERSON.test(text) || REAL_PERSON.test(text))
    return 'A generated picture never shows a real person. Describe someone made up, or no one.'
  return null
}

/** What a persona generated today, against MEDIA_BUDGET. */
export interface MediaSpend {
  images: number
  clipSeconds: number
}

/** Why one more generation would pass the day's budget; none when it fits. */
export function budgetProblem(kind: MediaKind, spent: MediaSpend): string | null {
  if (kind === 'image' && spent.images + 1 > MEDIA_BUDGET.images)
    return `Today's budget of ${MEDIA_BUDGET.images} images is spent (${spent.images} made). It resets at midnight in the persona's timezone.`
  if (kind === 'clip' && spent.clipSeconds + CLIP_SECONDS > MEDIA_BUDGET.clipSeconds)
    return `Today's budget of ${MEDIA_BUDGET.clipSeconds} seconds of clips is spent (${spent.clipSeconds} s made). It resets at midnight in the persona's timezone.`
  return null
}

/**
 * The prompt the model gets: the operator's or the writer's words in the
 * persona's look, and never text, logos or a real person, whatever the words
 * ask. A persona with no presenter gets clean illustrations.
 */
export function providerPrompt(prompt: string, appearance: Appearance | null): string {
  const face = appearance === null ? null : presenterFace(appearance)
  const look =
    face === 'photoreal'
      ? 'A realistic photograph.'
      : face === 'cartoon'
        ? 'A bold, friendly cartoon illustration.'
        : 'A clean, flat illustration.'
  return `${prompt.trim().replace(/[.!?]+$/, '')}. ${look} No words, no logos, no real people.`
}

/**
 * The prompt for a persona's portrait (docs/plan.md, slice 17): the face
 * every avatar take is animated from, from the operator's description of it,
 * drawn in the look's face and framed the way the look needs (a Loom-style
 * face is a webcam's). Always a made-up person.
 */
export function portraitPrompt(description: string, appearance: Appearance): string {
  const face = presenterFace(appearance)
  if (face === null) throw new Error('a look with no presenter has no portrait')
  const kind = face === 'photoreal' ? 'A realistic photograph' : 'A bold, friendly cartoon portrait'
  const frame =
    appearance.style === 'loom'
      ? 'framed like a webcam: a made-up presenter at a desk, head and shoulders, looking into the camera, soft home-office light'
      : 'of a made-up presenter, head and shoulders, looking into the camera, soft even light, plain light background'
  return `${kind} ${frame}. ${description.trim().replace(/[.!?]+$/, '')}. No words, no logos, not a real person.`
}

/**
 * Each persona color as a CSS color, for what the backend draws itself (the
 * mock media card). It mirrors the studio's `--color-persona-*` (styles.css,
 * the source of truth; a studio test keeps the two equal), with ink resolved
 * to the ink token's value.
 */
export const PERSONA_COLOR_VALUES: Record<PersonaColor, string> = {
  ink: 'oklch(24% 0.008 90)',
  plum: 'oklch(47% 0.13 342)',
  violet: 'oklch(50% 0.17 298)',
  iris: 'oklch(56% 0.14 260)',
  teal: 'oklch(55% 0.09 200)',
  olive: 'oklch(55% 0.1 125)',
  clay: 'oklch(56% 0.13 45)',
  rose: 'oklch(57% 0.17 3)',
}
