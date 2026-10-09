import type { SponsorSegment } from '@influstep/shared'

/**
 * What the writer asks of a language model. Both adapters return the same
 * shape, so the pipeline never knows which one answered.
 */
export interface ScriptBrief {
  persona: { name: string; handle: string; niche: string; tone: string; bible: string; pillars: string[] }
  concept: string
  pillar: string
  sponsorSegment: SponsorSegment
  sponsorName: string
  variant?: { key: string; description: string }
  directives: string[]
  signals: { title: string; summary: string; url: string }[]
  /** Platforms the episode goes to, so the writer keeps the length right. */
  platforms: string[]
}

export interface ScriptDraft {
  title: string
  hook: string
  script: { hook: string; body: string; sponsor: string; cta: string }
  /** The screen the producer records, as a named tool and what to show. */
  shotPlan: { title: string; voiceover: string; tool: string; url: string }[]
  /** Short labels the researcher later matches comments and signals against. */
  topics: string[]
}

export interface ChatTurn {
  author: 'operator' | 'persona'
  text: string
}

export interface LlmProvider {
  readonly name: string
  writeScript(brief: ScriptBrief): Promise<ScriptDraft>
  /** The persona's reply in its own chat; `directive` is set when the message was stored as one. */
  reply(args: { persona: ScriptBrief['persona']; history: ChatTurn[]; directive?: string }): Promise<string>
}
