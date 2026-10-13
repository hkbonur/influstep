import type { ImportedPost } from '@influstep/shared'

/**
 * Reads an X account's own history for a takeover (docs/plan.md, slice 5).
 * Reading only: nothing here posts, likes or follows.
 */
export interface TimelineQuery {
  handle: string
  niche: string
  pillars: string[]
  /** The newest post is dated just before this instant. */
  now: number
}

export interface TimelineProvider {
  readonly name: string
  /** The account's posts, newest first, threads folded into their root as shared `parseXArchive` does. */
  history(query: TimelineQuery): Promise<ImportedPost[]>
}

/** What the operator reads when Import from X runs in real mode: the timeline needs the X adapter, which needs X_OAUTH. */
export const X_TIMELINE_NEEDS_OAUTH = 'Reading the timeline needs X_OAUTH; the X adapter is not built yet.'
