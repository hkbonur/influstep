import { isPost, lengthKindProblem, postHook, postProblems, type EpisodePost, type PostKind, type PostLength } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { refusal } from '../lib/errors'

/**
 * Posts on X (docs/plan.md, slice 4): saving a written post. The writer and
 * the operator's editor both save through `savePost`, so a post's hook is
 * computed one way and no post is stored that X would refuse. A post goes
 * out exactly as written, with no footer.
 */

/** The X publication of an episode, when it has one. */
export async function findXPublication(ctx: { db: QueryCtx['db'] }, episodeId: Id<'episodes'>): Promise<Doc<'publications'> | null> {
  return ctx.db
    .query('publications')
    .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
    .filter((q) => q.eq(q.field('platform'), 'x'))
    .first()
}

/** The post, when it is one X takes; otherwise a refusal naming the first problem. */
export function assertPostFits(kind: PostKind, post: EpisodePost | undefined): EpisodePost {
  if (!post) throw refusal('The post is not written yet.')
  const [problem] = postProblems(kind, post)
  if (problem) throw refusal(problem)
  return post
}

/**
 * A thread is always long and a text or image post never is (shared
 * `lengthKindProblem`): the planner draws the length first and picks the kind
 * from it, so a mismatch is refused wherever a post's length is written.
 */
export function assertLengthFitsKind(kind: PostKind, length: PostLength): void {
  const problem = lengthKindProblem(kind, length)
  if (problem) throw refusal(problem)
}

/**
 * Whether a save would give an image post a card title its rendered card
 * does not show. A retry publishes the card already rendered and never
 * renders it again, so the card title stays as rendered until a rewrite
 * drops the card (private/episodes.ts `rewrite`).
 */
function changesRenderedCard(episode: Doc<'episodes'>, post: EpisodePost): boolean {
  if (episode.kind !== 'image') return false
  if (episode.renders.length === 0) return false
  if (!episode.post) throw new Error(`image post ${episode._id} has a rendered card but no post`)
  return post.cardTitle !== episode.post.cardTitle
}

/**
 * Stores a written post and its hook, refusing an episode whose length does
 * not fit its kind. A publication that has not gone out
 * (one that failed and waits for a retry) takes the new parts too, so a
 * retry publishes what the post says now.
 */
export async function savePost(ctx: MutationCtx, episodeId: Id<'episodes'>, args: { title: string; post: EpisodePost }): Promise<void> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  if (!isPost(episode.kind)) throw refusal('A video has a script, not a post.')
  const post = assertPostFits(episode.kind, args.post)
  // A post planned before intents and lengths existed has no length to check.
  if (episode.length !== undefined) assertLengthFitsKind(episode.kind, episode.length)
  if (changesRenderedCard(episode, post)) throw refusal('The card is already rendered; rewrite the post to change it.')
  await ctx.db.patch(episodeId, { title: args.title, post, hook: postHook(post.parts), updatedAt: Date.now() })

  const publication = await findXPublication(ctx, episodeId)
  if (!publication || publication.status === 'live' || publication.status === 'uploading') return
  await ctx.db.patch(publication._id, { title: args.title, parts: post.parts })
}
