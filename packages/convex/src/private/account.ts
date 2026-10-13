import { v } from 'convex/values'
import { IMPORT_BATCH_MAX } from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import {
  accountCountsOf,
  accountHistoryOf,
  assertVoiceEdit,
  deleteHistoryPage,
  examplePostsOf,
  insertAccountPosts,
  newestAccountPostsOf,
  requireXPersona,
  setExamplePost,
  topOriginalsOf,
  voiceSampleOf,
  type AccountTotals,
} from '../core/account'
import { enqueueJob } from '../jobs/queue'
import { refusal } from '../lib/errors'
import { importedPostValidator } from '../lib/validators'

/**
 * The voice page (docs/plan.md, slice 5): the history of the X account a
 * persona took over, and the voice learned from it. The studio parses an
 * archive or a paste in the browser and sends the posts here in batches;
 * "Import from X" and "Learn the voice" are jobs. Importing only reads the
 * account.
 */

/** The most posts a list on the voice page asks for; the lists are index reads, so each read stays small. */
const LIST_LIMIT_MAX = 100

/** Store a batch of posts the studio parsed from an archive or a paste. Posts the persona already holds are skipped. */
export const importPosts = mutation({
  args: {
    personaId: v.id('personas'),
    source: v.union(v.literal('archive'), v.literal('paste')),
    posts: v.array(importedPostValidator),
  },
  handler: async (ctx, args): Promise<{ added: number; skipped: number }> => {
    await requireXPersona(ctx, args.personaId)
    if (args.posts.length > IMPORT_BATCH_MAX) throw refusal(`Import at most ${IMPORT_BATCH_MAX} posts at a time.`)
    return insertAccountPosts(ctx, args)
  },
})

/** Queue the researcher to read the account's timeline (mock history until the X adapter exists). */
export const importFromX = mutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<Id<'jobs'>> => {
    await requireXPersona(ctx, args.personaId)
    return enqueueJob(ctx, { kind: 'import_x_history', payload: { personaId: args.personaId }, personaId: args.personaId })
  },
})

/** The newest `limit` imported posts, the totals over all of them, and whether Clear history is still deleting them. */
export const history = query({
  args: { personaId: v.id('personas'), limit: v.number() },
  handler: async (ctx, args): Promise<{ posts: Doc<'accountPosts'>[]; totals: AccountTotals; clearing: boolean }> => {
    assertLimit(args.limit)
    const { totals, clearing } = await accountHistoryOf(ctx, args.personaId)
    return { posts: await newestAccountPostsOf(ctx, args.personaId, args.limit), totals, clearing }
  },
})

/**
 * The account's example posts first, then up to `limit` other originals by
 * likes plus reposts: the first evidence of what works for this account.
 * Replies to other people are not candidates; the writer writes originals.
 */
export const topPosts = query({
  args: { personaId: v.id('personas'), limit: v.number() },
  handler: async (ctx, args): Promise<Doc<'accountPosts'>[]> => {
    assertLimit(args.limit)
    const examples = (await examplePostsOf(ctx, args.personaId)).filter((post) => !post.isReply)
    // The examples are among the top originals too, so reading past them by their number leaves `limit` others.
    const top = (await topOriginalsOf(ctx, args.personaId, args.limit + examples.length))
      .filter((post) => !post.example)
      .slice(0, args.limit)
    return [...examples, ...top]
  },
})

/** Queue the analyst to learn the voice, once there are enough originals to learn from. */
export const learnVoice = mutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<Id<'jobs'>> => {
    await requireXPersona(ctx, args.personaId)
    // Refuses while Clear history is deleting posts, or with too few originals to learn from.
    voiceSampleOf(await accountCountsOf(ctx, args.personaId))
    return enqueueJob(ctx, { kind: 'learn_voice', payload: { personaId: args.personaId }, personaId: args.personaId })
  },
})

/** Save the operator's edit of the learned voice: its language, summary and traits. The counted part stays as learned. */
export const updateVoice = mutation({
  args: { personaId: v.id('personas'), language: v.string(), summary: v.string(), traits: v.array(v.string()) },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    if (!persona.voice) throw refusal('Learn the voice first; there is nothing to edit yet.')
    const edit = assertVoiceEdit({ language: args.language, summary: args.summary, traits: args.traits })
    await ctx.db.patch(args.personaId, { voice: { ...persona.voice, ...edit } })
  },
})

/** Mark or unmark an imported post as an example the writer imitates. */
export const setExample = mutation({
  args: { accountPostId: v.id('accountPosts'), example: v.boolean() },
  handler: async (ctx, args) => setExamplePost(ctx, args.accountPostId, args.example),
})

/**
 * Delete the persona's imported posts and the voice learned from them. The
 * first page goes now, so a history of up to a page is gone when this
 * returns; a bigger one is deleted a page per scheduled mutation
 * (internal/data.ts, deleteHistoryPage), and the history says it is being
 * deleted until the last page is gone. Called again while pages are left, it
 * deletes one more and queues the rest again; a post is never deleted twice.
 */
export const clearHistory = mutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<{ deleted: number; more: boolean }> => {
    const page = await deleteHistoryPage(ctx, args.personaId)
    if (page.more) await ctx.scheduler.runAfter(0, internal.internal.data.deleteHistoryPage, { personaId: args.personaId })
    return page
  },
})

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT_MAX) {
    throw new Error(`a list limit is a whole number from 1 to ${LIST_LIMIT_MAX}, not ${limit}`)
  }
}
