import { runnerAlive } from '@influstep/shared'
import { useNow } from './use-now'

/** How often the runner's liveness is judged again: well inside RUNNER_STALE_MS, so a silent runner reads offline soon after it goes stale. */
const RUNNER_CLOCK_MS = 30_000

/**
 * Whether the runner last heard from at `lastSeenAt` is alive, by the shared
 * rule against the studio's own clock. A query cannot judge it: it re-runs
 * only when a row it read changes, and a runner that stops beating changes
 * none, so "online" would hold until something else happened. Null means no
 * runner ever checked in.
 */
export function useRunnerOnline(lastSeenAt: number | null): boolean {
  const now = useNow(RUNNER_CLOCK_MS)
  if (lastSeenAt === null) return false
  return runnerAlive(lastSeenAt, now)
}
