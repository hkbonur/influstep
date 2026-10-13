/**
 * One episode on one platform (CONTEXT.md, "Publish package"). A rendered
 * episode's publications wait as drafts until the operator approves the
 * package, unless the persona publishes on its own. Only a queued
 * publication is ever handed to the runner.
 */
export const PUBLICATION_STATUSES = ['draft', 'queued', 'uploading', 'live', 'failed'] as const
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number]

export const PUBLICATION_STATUS_LABELS: Record<PublicationStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  uploading: 'Uploading',
  live: 'Live',
  failed: 'Failed',
}

/** Characters of a video publication's title off X: YouTube's limit, the strictest of the platforms. */
export const PUBLICATION_TITLE_MAX = 100

/** Characters of the persona's own description text; the footer composed at dispatch comes on top. */
export const PUBLICATION_BODY_MAX = 1500
