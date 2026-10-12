import type { Infer } from 'convex/values'
import type { Delivery, SponsorSegment } from '@influstep/shared'
import type { shotPlanValidator } from '../../lib/validators'

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
  /** The episode's format: how long, who is on camera, and the hook convention of every platform it goes to. */
  format: { lengthSec: number; delivery: Delivery; hookNotes: string[] }
}

/** Spoken pace the length budget is written for. */
export const WORDS_PER_SECOND = 2.4

/** The "tool" of a beat the presenter speaks to camera: no screen, no URL, an avatar take whatever the delivery. */
export const PRESENTER_TOOL = 'presenter'

export interface ScriptDraft {
  title: string
  hook: string
  script: { hook: string; body: string; sponsor: string; cta: string }
  /** The beats the producer records: a named tool and what to show, or the presenter (tool PRESENTER_TOOL, no URL). */
  shotPlan: Infer<typeof shotPlanValidator>
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
