import type { MediaKind, PersonaColor } from '@influstep/shared'

/** What the producer asks the media provider for: one still or one clip, from a prompt already in the persona's look. */
export interface MediaRequest {
  kind: MediaKind
  /** The prompt the model gets (shared `providerPrompt`). */
  prompt: string
  /** The words the operator or the writer used, which a mock card prints. */
  shownPrompt: string
  personaName: string
  color: PersonaColor
  /** A portrait is drawn square, the shape every avatar take and every bubble crops it to; anything else is wide. */
  shape: 'wide' | 'square'
}

/** The file the provider made, ready for storage, and the model that made it. */
export interface MediaResult {
  bytes: ArrayBuffer
  contentType: string
  model: string
  mock: boolean
}

export interface MediaProvider {
  name: string
  generate(request: MediaRequest): Promise<MediaResult>
}
