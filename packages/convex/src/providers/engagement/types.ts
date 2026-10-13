import type { HeardPost, ReplyCounts } from '@influstep/shared'

/** Who the listener listens for, and the moment it listens at. */
export interface ListenQuery {
  handle: string
  niche: string
  pillars: string[]
  /** The sponsor's name: people ask about it too, and the listener hears them. */
  sponsorName: string
  now: number
}

/**
 * Engagement on X (docs/plan.md, slice 11): what the listener hears and
 * what a sent reply brought back. Reading only: posting a reply is the
 * runner's (apps/runner `postReply`), and nothing here likes, reposts or
 * follows.
 */
export interface EngagementProvider {
  readonly name: string
  /** Posts that mention the persona, replies under its posts, and posts in its pillars, newest first. */
  listen(query: ListenQuery): Promise<HeardPost[]>
  /** What one sent reply brought back so far. */
  counts(args: { externalId: string; sentAt: number }): Promise<ReplyCounts>
}

/** What the operator reads when the listener runs in real mode: search needs X API access, which the X adapter will use. */
export const X_LISTENING_NEEDS_SEARCH = 'Listening needs X API search access; the X adapter is not built yet.'

/** What the analyst reads when it measures a reply in real mode. */
export const X_REPLY_COUNTS_NEED_OAUTH = "Reading a reply's numbers needs X_OAUTH; the X adapter is not built yet."
