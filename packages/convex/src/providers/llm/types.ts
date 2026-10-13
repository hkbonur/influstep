import {
  SHORT_POST_MAX,
  THREAD_PARTS_MAX,
  THREAD_PARTS_MIN,
  X_POST_LIMIT,
  type Beat,
  type ChatIntent,
  type ChatTask,
  type Delivery,
  type EffectiveVariant,
  type EpisodeKind,
  type EpisodePost,
  type ExperimentKind,
  type PostIntent,
  type PostKind,
  type PostLength,
  type ScriptKind,
  type SignalSource,
  type SponsorSegment,
  type Voice,
  type VoiceStats,
  type Weekday,
} from '@influstep/shared'
import type { WriterAsset } from '../../core/assets'
import type { WriterMemory } from '../../core/memory'
import type { Funnel } from '../../core/report'

/**
 * What the researcher has for the writer: this morning's brief, null when
 * no sweep wrote one or it expired, and the persona's open problems, newest
 * first. Both are the persona's own words.
 */
export interface WriterResearch {
  brief: string | null
  problems: string[]
}

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
  /** Where a demo beat opens the sponsor on screen. */
  sponsorUrl: string
  /** The experiment variant this episode carries, with the dimension its experiment varies, when that dimension is one the writer scripts. */
  variant?: { kind: ScriptKind; key: string; description: string }
  /** What the persona knows (core/memory.ts `writerMemory`): its goal and standing, the operator's rules and facts, its learnings. */
  memory: WriterMemory
  /** The images and clips of the persona's asset library a beat may show, by name (core/assets.ts `writerAssets`). */
  assets: WriterAsset[]
  /**
   * What the episode does on every dimension (shared `effectiveStyle`): its
   * own variant where its experiment varies the dimension, else the persona's
   * default, else the catalog control. The mock writer's hook and closing
   * line read it.
   */
  style: Record<ExperimentKind, EffectiveVariant>
  /** The dimensions that differ from the control, one line each, without the variant's own dimension (shared `styleLines`). */
  styleLines: string[]
  directives: string[]
  signals: { title: string; summary: string; url: string }[]
  research: WriterResearch
  /**
   * The episode's format: how long, who is on camera, and the hook convention
   * of every platform it goes to. The length is the format's, scaled by the
   * episode-length variant in force (shared `variantLength`).
   */
  format: { lengthSec: number; delivery: Delivery; hookNotes: string[] }
  /** What was wrong with the previous draft, on the one retry; empty on the first try. */
  problems: string[]
}

/** The "tool" of a beat the presenter speaks to camera: no screen, no URL, an avatar take whatever the delivery. */
export const PRESENTER_TOOL = 'presenter'

/**
 * A beat as the writer writes it: an asset of the brief's library asked for
 * by its name, which the pipeline resolves to the asset's id
 * (core/assets.ts `placeAssets`).
 */
export type DraftBeat = Omit<Beat, 'assetId'> & { asset?: string }

export interface ScriptDraft {
  title: string
  /**
   * One to three sentences in the persona's voice about what the video shows:
   * the default body of every video publication. No link, no code, no
   * disclosure: the footer adds those when it goes out.
   */
  description: string
  /**
   * The beats are the script: each voiceover is exactly what is spoken over
   * its beat, the first sentence of the first one is the hook, and the call
   * to action closes the last. A beat names the tool on screen and the URL
   * to open, or the presenter (tool PRESENTER_TOOL, no URL), and may show an
   * asset of the library instead.
   */
  shotPlan: DraftBeat[]
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
  memory: WriterMemory
  directives: string[]
  signals: ScriptBrief['signals']
  research: WriterResearch
  /** The hook convention of the persona's X format; the first line of the first part follows it. */
  hookNote: string
  partLimit: number
  /**
   * What the post sets out to do and how long it runs, as the planner chose
   * them. Null on a post planned before intents and lengths existed: it is
   * written to its kind alone, as it was then.
   */
  intent: PostIntent | null
  length: PostLength | null
  /** The account's learned voice; null until the analyst learns one, and the post is written in English in the bible's tone. */
  voice: Pick<Voice, 'language' | 'summary' | 'traits' | 'emoji' | 'hashtags'> | null
  /** The account's own example posts, each as its parts, verbatim: style to imitate, never words to copy. */
  examples: string[][]
  /** What was wrong with the previous draft, on the one retry; empty on the first try. */
  problems: string[]
}

/** What each length asks of the writer, in the words the prompt and a rejected draft both use. */
export const POST_LENGTH_TARGETS: Record<PostLength, string> = {
  short: `a one-liner: one part of at most ${SHORT_POST_MAX} characters`,
  medium: `a full post: one part of more than ${SHORT_POST_MAX} and at most ${X_POST_LIMIT} characters`,
  long: `a thread of ${THREAD_PARTS_MIN} to ${THREAD_PARTS_MAX} parts`,
}

export interface PostDraft {
  /** A short name for the calendar and the publication; X shows no title. */
  title: string
  /** The parts as X receives them, and the card title for an image post. */
  post: EpisodePost
}

/** One of the account's own posts as the analyst reads it. */
export interface AccountPostSample {
  parts: string[]
  /** X's language tag for the post; null when X could not tell. */
  lang: string | null
  likes: number
  reposts: number
}

/**
 * What the analyst asks of a language model to learn an account's voice.
 * Everything countable is counted in code first (`stats`); the model writes
 * only the language, the summary and the traits.
 */
export interface VoiceBrief {
  persona: ScriptBrief['persona']
  stats: VoiceStats
  /** The originals with the most likes plus reposts, best first. */
  top: AccountPostSample[]
  /** The newest originals not already in `top`, newest first. */
  newest: AccountPostSample[]
}

export interface VoiceDraft {
  /** A BCP 47 tag such as `en`, `nb`, `tr`. */
  language: string
  summary: string
  /** One to VOICE_TRAITS_MAX recurring moves, each a short phrase. */
  traits: string[]
}

export interface ChatTurn {
  author: 'operator' | 'persona'
  text: string
}

/** One episode a chat message may change (core `changeablePlan`), as the interpreter reads it. */
export interface PlanRow {
  id: string
  weekday: Weekday
  /** The local day it is planned for, YYYY-MM-DD in the persona's timezone. */
  plannedFor: string
  kind: EpisodeKind
  title: string
  pillar: string | null
  /** The status as the operator reads it (EPISODE_STATUS_LABELS). */
  status: string
}

export interface InterpretArgs {
  persona: ScriptBrief['persona']
  /** The chat before the message, oldest first. */
  history: ChatTurn[]
  plan: PlanRow[]
  /** The operator's message to read. */
  text: string
}

/** A signal as a task report reads it; a comment is a signal whose title is the comment's text. */
export interface TaskSignal {
  source: SignalSource
  title: string
  summary: string
  url: string
  topics: string[]
}

/** What each chat task is written from. Code reads and counts it; the model only puts it in words. */
interface TaskData {
  research_brief: { signals: TaskSignal[] }
  /** The most liked comments of the window, most liked first; `total` counts every comment in it. */
  comment_digest: { days: number; total: number; comments: TaskSignal[] }
  analytics_summary: { days: number; funnel: Funnel; currency: string }
}

/** One member per task, so narrowing on `task` narrows `data` with it. */
export type TaskReportArgs = {
  [Task in ChatTask]: { persona: ScriptBrief['persona']; task: Task; topic: string | null; data: TaskData[Task] }
}[ChatTask]

export interface LlmProvider {
  readonly name: string
  writeScript(brief: ScriptBrief): Promise<ScriptDraft>
  writePost(brief: PostBrief): Promise<PostDraft>
  learnVoice(brief: VoiceBrief): Promise<VoiceDraft>
  /** The persona's reply in its own chat; `directive` is set when the message was stored as one. */
  reply(args: { persona: ScriptBrief['persona']; history: ChatTurn[]; directive?: string }): Promise<string>
  /** What an operator's chat message asks for; `conversation` when it asks for no change and no task. */
  interpret(args: InterpretArgs): Promise<ChatIntent>
  /** A chat task's answer in the persona's voice, from the data alone. */
  taskReport(args: TaskReportArgs): Promise<string>
}
