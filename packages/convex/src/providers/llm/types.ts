import type { Infer } from 'convex/values'
import type { Delivery, EpisodePost, PostKind, SponsorSegment } from '@influstep/shared'
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

/**
 * What the writer asks of a language model for a post on X. The limit is X's,
 * weighed the way X weighs it (xLength), and holds for every part: X gets the
 * parts exactly as written, with nothing appended.
 */
export interface PostBrief {
  persona: ScriptBrief['persona']
  kind: PostKind
  concept: string
  pillar: string
  sponsorSegment: SponsorSegment
  sponsorName: string
  directives: string[]
  signals: ScriptBrief['signals']
  /** The hook convention of the persona's X format; the first line of the first part follows it. */
  hookNote: string
  partLimit: number
  /** What was wrong with the previous draft, on the one retry; empty on the first try. */
  problems: string[]
}

export interface PostDraft {
  /** A short name for the calendar and the publication; X shows no title. */
  title: string
  /** The parts as X receives them, and the card title for an image post. */
  post: EpisodePost
}

export interface ChatTurn {
  author: 'operator' | 'persona'
  text: string
}

export interface LlmProvider {
  readonly name: string
  writeScript(brief: ScriptBrief): Promise<ScriptDraft>
  writePost(brief: PostBrief): Promise<PostDraft>
  /** The persona's reply in its own chat; `directive` is set when the message was stored as one. */
  reply(args: { persona: ScriptBrief['persona']; history: ChatTurn[]; directive?: string }): Promise<string>
}
