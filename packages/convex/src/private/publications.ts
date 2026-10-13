import { v } from 'convex/values'
import {
  EPISODE_STATUS_LABELS,
  PUBLICATION_BODY_MAX,
  PUBLICATION_STATUS_LABELS,
  PUBLICATION_TITLE_MAX,
  PLATFORM_LABELS,
} from '@influstep/shared'
import { mutation } from '../_generated/server'
import { assertXTitleFits } from '../core/attribution'
import { applyEvent } from '../internal/data'
import { refusal } from '../lib/errors'

/**
 * The publish package (CONTEXT.md, "Publish package"): a rendered episode's
 * publications wait as drafts until the operator approves them, unless the
 * persona publishes on its own. The operator edits each draft's title and,
 * off X, the persona's own description text; the footer is composed at
 * dispatch (core/attribution.ts), so neither edit reaches it.
 */

/** Save one draft's title and body. A post publication goes out as its post was approved, so it has nothing to edit here. */
export const updateDraft = mutation({
  args: { publicationId: v.id('publications'), title: v.string(), body: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId)
    if (!publication) throw new Error(`publication ${args.publicationId} not found`)
    if (publication.parts !== undefined) throw refusal('A post goes out as it was approved; edit the post and approve it again.')
    if (publication.status !== 'draft') {
      throw refusal(
        `A publication can be edited until its package is approved; this one is ${PUBLICATION_STATUS_LABELS[publication.status].toLowerCase()}.`
      )
    }
    const title = args.title.trim()
    if (publication.platform === 'x') {
      if (title.length === 0) throw refusal('On X the title is the post; it cannot be empty.')
      assertXTitleFits(title)
      if (args.body !== undefined) throw refusal('Nothing is appended on X: the title is the whole post.')
      await ctx.db.patch(publication._id, { title })
      return
    }
    const titleLength = Array.from(title).length
    if (titleLength === 0 || titleLength > PUBLICATION_TITLE_MAX) {
      throw refusal(`A title is 1 to ${PUBLICATION_TITLE_MAX} characters, YouTube's limit; this one is ${titleLength}.`)
    }
    if (args.body === undefined) throw new Error(`the ${publication.platform} draft ${publication._id} was saved without a body`)
    const body = args.body.trim()
    const bodyLength = Array.from(body).length
    if (bodyLength > PUBLICATION_BODY_MAX) {
      throw refusal(
        `The ${PLATFORM_LABELS[publication.platform]} description is ${bodyLength} characters; it holds ${PUBLICATION_BODY_MAX} before the footer.`
      )
    }
    await ctx.db.patch(publication._id, { title, body })
  },
})

/**
 * Approve a rendered episode's publish package: every draft is queued at the
 * time it shows and the episode is scheduled. Approval of the script stays
 * the episode's approval time. Returns how many publications were queued.
 */
export const approvePackage = mutation({
  args: { episodeId: v.id('episodes') },
  handler: async (ctx, args): Promise<number> => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) throw new Error(`episode ${args.episodeId} not found`)
    const drafts = (
      await ctx.db
        .query('publications')
        .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
        .collect()
    ).filter((publication) => publication.status === 'draft')
    if (episode.status !== 'rendered' || drafts.length === 0) {
      throw refusal(
        `Only an episode at "${EPISODE_STATUS_LABELS.rendered}" can be approved; this one is at "${EPISODE_STATUS_LABELS[episode.status]}".`
      )
    }
    for (const draft of drafts) await ctx.db.patch(draft._id, { status: 'queued' })
    await applyEvent(ctx, episode._id, { type: 'scheduled' })
    return drafts.length
  },
})
