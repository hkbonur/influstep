import { canTransition, type EpisodeStatus } from '@influstep/shared'

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

export function transition(current: EpisodeStatus, event: PipelineEvent, options: { previous?: EpisodeStatus } = {}): TransitionResult {
  const target = TARGETS[event.type]
  const next = target === 'previous' ? options.previous : target
  if (!next) return { ok: false, reason: `retry needs the status the episode failed from` }
  if (!canTransition(current, next)) return { ok: false, reason: `an episode cannot go from ${current} to ${next}` }
  return { ok: true, status: next }
}
