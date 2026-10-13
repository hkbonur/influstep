import type { JobRuntime } from '@influstep/shared'

/**
 * What an agent is doing, in one line on the Agents page. Waiting for the
 * runner is its own state: queued jobs that only the operator's computer can
 * run will not move until the runner comes back, and saying "Idle" then would
 * hide why nothing happens.
 */
export type AgentState = { kind: 'working'; count: number } | { kind: 'waiting_for_runner' } | { kind: 'idle' }

/**
 * Running work first, then a stalled runner, then rest. The runner check reads
 * each queued job's runtime rather than the role, because the publisher also
 * owns backend jobs (reading comments, the comment digest) that run without
 * the runner. It looks at the oldest queued jobs only: backend jobs leave the
 * queue within seconds, so a runner job held by an offline runner is always
 * among the oldest.
 */
export function agentState(
  agent: { running: readonly unknown[]; queued: { next: readonly { runsOn: JobRuntime }[] } },
  runnerOnline: boolean
): AgentState {
  if (agent.running.length > 0) return { kind: 'working', count: agent.running.length }
  if (!runnerOnline && agent.queued.next.some((job) => job.runsOn === 'runner')) return { kind: 'waiting_for_runner' }
  return { kind: 'idle' }
}
