/**
 * One episode on one platform (CONTEXT.md, "Publish package"). A rendered
 * episode's publications wait as drafts until the operator approves the
 * package, unless the persona publishes on its own. Only a queued
 * publication is ever handed to the runner. A killed episode's publications
 * that had not gone out are withdrawn: they never go out, and the episode
 * keeps them so the calendar shows what was planned.
 */
export const PUBLICATION_STATUSES = ['draft', 'queued', 'uploading', 'live', 'failed', 'withdrawn'] as const
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number]

export const PUBLICATION_STATUS_LABELS: Record<PublicationStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  uploading: 'Uploading',
  live: 'Live',
  failed: 'Failed',
  withdrawn: 'Withdrawn',
}

/** Characters of a video publication's title off X: YouTube's limit, the strictest of the platforms. */
export const PUBLICATION_TITLE_MAX = 100

/** Characters of the persona's own description text; the footer composed at dispatch comes on top. */
export const PUBLICATION_BODY_MAX = 1500
