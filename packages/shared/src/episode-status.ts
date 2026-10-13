/**
 * The episode pipeline (CONTEXT.md, "Episode status"). The order here is the
 * order the calendar sorts by and the order the status pill legend shows.
 */
export const EPISODE_STATUSES = [
  'idea',
  'scripted',
  'waiting_on_you',
  'recording',
  'rendered',
  'scheduled',
  'published',
  'measured',
  'failed',
  'killed',
] as const

export type EpisodeStatus = (typeof EPISODE_STATUSES)[number]

/** Where an episode may go next. Terminal statuses map to an empty list. */
export const EPISODE_TRANSITIONS: Record<EpisodeStatus, readonly EpisodeStatus[]> = {
  idea: ['scripted', 'failed', 'killed'],
  // A text post or a thread has nothing to render, so approval schedules it straight away (core/pipeline.ts
  // refuses that move for a video or an image post).
  scripted: ['recording', 'scheduled', 'waiting_on_you', 'idea', 'failed', 'killed'],
  waiting_on_you: ['recording', 'scheduled', 'scripted', 'failed', 'killed'],
  recording: ['rendered', 'waiting_on_you', 'failed', 'killed'],
  rendered: ['scheduled', 'recording', 'failed', 'killed'],
  scheduled: ['published', 'failed', 'killed'],
  published: ['measured', 'failed'],
  measured: [],
  failed: ['idea', 'scripted', 'recording', 'rendered', 'scheduled', 'killed'],
  killed: [],
}

export function canTransition(from: EpisodeStatus, to: EpisodeStatus): boolean {
  return EPISODE_TRANSITIONS[from].includes(to)
}

/** Where an episode goes can change until it is approved: nothing is recorded yet for an idea or a scripted episode. */
export function platformsOpen(status: EpisodeStatus): boolean {
  return status === 'idea' || status === 'scripted'
}

const TEXT_EDITABLE: readonly EpisodeStatus[] = ['idea', 'scripted', 'waiting_on_you', 'failed']

/**
 * What an episode says, its script or its post, stays editable until recording
 * starts and again once it failed. The backend refuses an edit outside these
 * statuses and the studio locks its editors by the same rule.
 */
export function textEditable(status: EpisodeStatus): boolean {
  return TEXT_EDITABLE.includes(status)
}

/**
 * The statuses that wait on the operator: a script to approve, a sign-in to
 * do, a publish package to approve. Failed is not one of them: it has its own
 * mark everywhere (the sidebar's red dot, the calendar's failed count), so a
 * row never carries two.
 */
export const WAITS_ON_OPERATOR: readonly EpisodeStatus[] = ['scripted', 'waiting_on_you', 'rendered']

/** The one rule for "waits on you" counts: the sidebar badge, the persona list, the episode card's emphasis. */
export function waitsOnOperator(status: EpisodeStatus): boolean {
  return WAITS_ON_OPERATOR.includes(status)
}

export const EPISODE_STATUS_LABELS: Record<EpisodeStatus, string> = {
  idea: 'Idea',
  scripted: 'Needs approval',
  waiting_on_you: 'Waiting on you',
  recording: 'Recording',
  rendered: 'Ready to publish',
  scheduled: 'Scheduled',
  published: 'Published',
  measured: 'Measured',
  failed: 'Failed',
  killed: 'Killed',
}

/** The DESIGN.md status tint scale, as the semantic token each status maps to. */
export type StatusTint = 'fog' | 'note-blue' | 'alert-amber' | 'smoke' | 'field-green' | 'ink' | 'signal-red'

export const EPISODE_STATUS_TINTS: Record<EpisodeStatus, StatusTint> = {
  idea: 'fog',
  scripted: 'note-blue',
  waiting_on_you: 'alert-amber',
  recording: 'smoke',
  // A rendered episode waits for the operator to approve its publish package, like a script waiting for approval.
  rendered: 'note-blue',
  scheduled: 'field-green',
  published: 'field-green',
  measured: 'ink',
  failed: 'signal-red',
  killed: 'fog',
}

export const SPONSOR_SEGMENTS = ['none', 'mention', 'demo'] as const
export type SponsorSegment = (typeof SPONSOR_SEGMENTS)[number]

export const SPONSOR_SEGMENT_LABELS: Record<SponsorSegment, string> = {
  none: 'No sponsor',
  mention: 'Sponsor mention',
  demo: 'Sponsor demo',
}
