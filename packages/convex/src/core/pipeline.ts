import { canTransition, EPISODE_KIND_LABELS, type EpisodeKind, type EpisodeStatus } from '@influstep/shared'

/**
 * The episode state machine as the domain sees it: one function that either
 * returns the next status or explains why the move is not allowed. Handlers
 * call this and never patch `status` by hand.
 */
export type PipelineEvent =
  | { type: 'script_written' }
  | { type: 'approved' }
  | { type: 'blocked' }
  | { type: 'unblocked' }
  | { type: 'produced' }
  | { type: 'scheduled' }
  | { type: 'published' }
  | { type: 'measured' }
  | { type: 'failed'; error: string }
  | { type: 'killed' }
  | { type: 'retry' }
  | { type: 'rewrite' }

const TARGETS: Record<PipelineEvent['type'], EpisodeStatus | 'previous'> = {
  script_written: 'scripted',
  approved: 'recording',
  blocked: 'waiting_on_you',
  unblocked: 'recording',
  produced: 'rendered',
  scheduled: 'scheduled',
  published: 'published',
  measured: 'measured',
  failed: 'failed',
  killed: 'killed',
  retry: 'previous',
  rewrite: 'idea',
}

export type TransitionResult = { ok: true; status: EpisodeStatus } | { ok: false; reason: string }

/** Statuses an approved episode leaves for `scheduled` without a render, which only a text post or a thread may do. */
const UNRENDERED: readonly EpisodeStatus[] = ['scripted', 'waiting_on_you']

/** Kinds that have a render to publish, so they reach `scheduled` only through `rendered`. */
function rendersFirst(kind: EpisodeKind): boolean {
  return kind === 'video' || kind === 'image'
}

export function transition(
  current: EpisodeStatus,
  event: PipelineEvent,
  options: { kind: EpisodeKind; previous?: EpisodeStatus }
): TransitionResult {
  const target = TARGETS[event.type]
  const next = target === 'previous' ? options.previous : target
  if (!next) return { ok: false, reason: `retry needs the status the episode failed from` }
  if (!canTransition(current, next)) return { ok: false, reason: `an episode cannot go from ${current} to ${next}` }
  if (next === 'scheduled' && UNRENDERED.includes(current) && rendersFirst(options.kind)) {
    return { ok: false, reason: `${EPISODE_KIND_LABELS[options.kind]} cannot go from ${current} to scheduled: it renders first` }
  }
  return { ok: true, status: next }
}
