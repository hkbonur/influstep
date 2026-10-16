import { z } from 'zod'
import { PLACEABLE_ASSET_KINDS } from './assets'
import { APPEARANCE_STYLES, REFERENCE_KINDS } from './appearance'
import { ASPECT_RATIOS, PLATFORMS } from './platforms'

export const AGENT_ROLES = ['researcher', 'writer', 'producer', 'publisher', 'analyst'] as const
export type AgentRole = (typeof AGENT_ROLES)[number]

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  researcher: 'Researcher',
  writer: 'Writer',
  producer: 'Producer',
  publisher: 'Publisher',
  analyst: 'Analyst',
}

export const JOB_RUNTIMES = ['backend', 'runner'] as const
export type JobRuntime = (typeof JOB_RUNTIMES)[number]

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/** A runner silent this long is not alive, and a running job nobody reported for this long is orphaned. */
export const RUNNER_STALE_MS = 2 * 60_000

/**
 * Whether a runner last heard from at `lastSeenAt` is alive at `now`. The
 * studio reads it against its own clock: a query computing it on the backend
 * re-runs only when a row changes, so once the runner stops beating, nothing
 * would say it went silent.
 */
export function runnerAlive(lastSeenAt: number, now: number): boolean {
  return now - lastSeenAt < RUNNER_STALE_MS
}

/**
 * Every unit of agent work. `runsOn` says which process executes it: the
 * backend runs HTTP-only work, the runner runs what needs a browser, ffmpeg,
 * or the operator's sessions (ADR 0001).
 */
export const JOB_KINDS = {
  poll_signals: { role: 'researcher', runsOn: 'backend' },
  // Every morning: poll the sources, log repeated questions as problems, write the daily brief.
  morning_sweep: { role: 'researcher', runsOn: 'backend' },
  plan_week: { role: 'writer', runsOn: 'backend' },
  write_script: { role: 'writer', runsOn: 'backend' },
  produce: { role: 'producer', runsOn: 'runner' },
  publish: { role: 'publisher', runsOn: 'runner' },
  poll_comments: { role: 'publisher', runsOn: 'backend' },
  pull_metrics: { role: 'analyst', runsOn: 'backend' },
  evaluate_experiments: { role: 'analyst', runsOn: 'backend' },
  review_strategy: { role: 'analyst', runsOn: 'backend' },
  open_browser: { role: 'producer', runsOn: 'runner' },
  import_x_history: { role: 'researcher', runsOn: 'backend' },
  learn_voice: { role: 'analyst', runsOn: 'backend' },
  // Engagement on X (shared replies.ts): the listener's sweep, the writer's replies, and the one that sends a reply.
  listen_x: { role: 'researcher', runsOn: 'backend' },
  write_replies: { role: 'writer', runsOn: 'backend' },
  post_reply: { role: 'publisher', runsOn: 'runner' },
  // Onboarding (shared appearance.ts): the voice provider makes a persona's spoken voice from the operator's description.
  design_voice: { role: 'producer', runsOn: 'runner' },
  // Tasks the operator gives a persona in its chat (shared CHAT_TASKS): the role that owns the data answers there.
  research_brief: { role: 'researcher', runsOn: 'backend' },
  comment_digest: { role: 'publisher', runsOn: 'backend' },
  analytics_summary: { role: 'analyst', runsOn: 'backend' },
} as const satisfies Record<string, { role: AgentRole; runsOn: JobRuntime }>

export type JobKind = keyof typeof JOB_KINDS

export const JOB_KIND_LIST = Object.keys(JOB_KINDS) as JobKind[]

export const JOB_KIND_LABELS: Record<JobKind, string> = {
  poll_signals: 'Poll signals',
  morning_sweep: 'Morning sweep',
  plan_week: 'Plan the week',
  write_script: 'Write script',
  produce: 'Record, voice, render',
  publish: 'Publish',
  poll_comments: 'Read comments',
  pull_metrics: 'Pull metrics',
  evaluate_experiments: 'Evaluate experiments',
  review_strategy: 'Review strategy',
  open_browser: 'Open browser for sign-in',
  import_x_history: 'Import X history',
  learn_voice: 'Learn the voice',
  listen_x: 'Listen on X',
  write_replies: 'Write replies',
  post_reply: 'Post a reply',
  design_voice: 'Make the voice',
  research_brief: 'Research brief',
  comment_digest: 'Comment digest',
  analytics_summary: 'Analytics summary',
}

// ---------------------------------------------------------------------------
// Runner job contracts. The backend validates what it hands out and what comes
// back; the runner validates what it receives. One schema, both sides.
// ---------------------------------------------------------------------------

export const shotSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('screen'),
    id: z.string(),
    title: z.string(),
    voiceover: z.string(),
    recipe: z.array(
      z.discriminatedUnion('step', [
        z.object({ step: z.literal('goto'), url: z.string() }),
        z.object({ step: z.literal('click'), selector: z.string() }),
        z.object({ step: z.literal('type'), selector: z.string(), text: z.string() }),
        z.object({ step: z.literal('wait'), ms: z.number().int().positive() }),
        z.object({ step: z.literal('scroll'), y: z.number() }),
      ])
    ),
  }),
  z.object({ kind: z.literal('avatar'), id: z.string(), title: z.string(), voiceover: z.string() }),
  z.object({ kind: z.literal('title'), id: z.string(), title: z.string(), voiceover: z.string() }),
  // An image or a clip of the asset library, held or looped for the beat's length (shared `Beat.assetId`).
  z.object({
    kind: z.literal('asset'),
    id: z.string(),
    title: z.string(),
    voiceover: z.string(),
    assetId: z.string(),
  }),
])
export type Shot = z.infer<typeof shotSchema>
export type RecipeStep = Extract<Shot, { kind: 'screen' }>['recipe'][number]

/**
 * What the producer makes: a video records, voices and renders one cut per
 * aspect; an image post renders its one 16:9 title card, with no voice.
 */
export const producePayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('video'),
    episodeId: z.string(),
    personaHandle: z.string(),
    voiceId: z.string(),
    // The persona's look, which every avatar take reads; null for a persona made before looks existed.
    appearance: z
      .object({
        style: z.enum(APPEARANCE_STYLES),
        // Where the runner downloads each reference, in the order the operator gave them.
        references: z.array(z.object({ assetId: z.string(), url: z.string(), kind: z.enum(REFERENCE_KINDS) })),
      })
      .nullable(),
    shots: z.array(shotSchema).min(1),
    aspects: z.array(z.enum(ASPECT_RATIOS)).min(1),
    // Where the runner downloads each asset its asset shots show, once per job, and whether it holds or loops it.
    assets: z.array(z.object({ assetId: z.string(), url: z.string(), kind: z.enum(PLACEABLE_ASSET_KINDS) })),
  }),
  z.object({
    kind: z.literal('image'),
    episodeId: z.string(),
    cardTitle: z.string(),
    personaName: z.string(),
    handle: z.string(),
  }),
])
export type ProducePayload = z.infer<typeof producePayloadSchema>
/** A video's look as the producer reads it; null for a persona made before looks existed. */
export type ProduceAppearance = Extract<ProducePayload, { kind: 'video' }>['appearance']

/** An image render is one card at `durationSec: 0`. */
export const produceResultSchema = z.object({
  renders: z.array(z.object({ aspect: z.enum(ASPECT_RATIOS), storageId: z.string(), durationSec: z.number(), mock: z.boolean() })),
  voiceStorageId: z.string().optional(),
  captionsStorageId: z.string().optional(),
})
export type ProduceResult = z.infer<typeof produceResultSchema>

/**
 * What the publisher uploads: a video's render with its title and
 * description, or a post's parts exactly as written for X, with the card as
 * media when it is an image post.
 */
export const publishPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('video'),
    publicationId: z.string(),
    platform: z.enum(PLATFORMS),
    title: z.string(),
    description: z.string(),
    renderStorageId: z.string(),
    renderUrl: z.string(),
    scheduledAt: z.number(),
  }),
  z.object({
    kind: z.literal('post'),
    publicationId: z.string(),
    platform: z.literal('x'),
    parts: z.array(z.string()).min(1),
    mediaStorageId: z.string().optional(),
    mediaUrl: z.string().optional(),
    scheduledAt: z.number(),
  }),
])
export type PublishPayload = z.infer<typeof publishPayloadSchema>

export const publishResultSchema = z.object({
  externalId: z.string(),
  url: z.string(),
  publishedAt: z.number(),
  mock: z.boolean(),
})
export type PublishResult = z.infer<typeof publishResultSchema>

/** One reply to post on X, exactly as written, under the post it answers. */
export const postReplyPayloadSchema = z.object({ replyId: z.string(), inReplyTo: z.string(), text: z.string().min(1) })
export type PostReplyPayload = z.infer<typeof postReplyPayloadSchema>

export const openBrowserPayloadSchema = z.object({ url: z.string(), checklistItemId: z.string() })
export type OpenBrowserPayload = z.infer<typeof openBrowserPayloadSchema>

/** A spoken voice to make from the operator's words; the result is the voice id the producer speaks with. */
export const designVoicePayloadSchema = z.object({ personaId: z.string(), personaName: z.string(), description: z.string().min(1) })
export type DesignVoicePayload = z.infer<typeof designVoicePayloadSchema>

export const designVoiceResultSchema = z.object({ voiceId: z.string().min(1), mock: z.boolean() })
export type DesignVoiceResult = z.infer<typeof designVoiceResultSchema>

export const runnerJobSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), kind: z.literal('produce'), payload: producePayloadSchema }),
  z.object({ id: z.string(), kind: z.literal('publish'), payload: publishPayloadSchema }),
  z.object({ id: z.string(), kind: z.literal('open_browser'), payload: openBrowserPayloadSchema }),
  z.object({ id: z.string(), kind: z.literal('post_reply'), payload: postReplyPayloadSchema }),
  z.object({ id: z.string(), kind: z.literal('design_voice'), payload: designVoicePayloadSchema }),
])
export type RunnerJob = z.infer<typeof runnerJobSchema>
