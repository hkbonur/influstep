import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { platformsOf } from '../core/formats'
import { askForReply, listens, postReplyNow, repliesView, skipReply } from '../core/replies'
import { enqueueJob } from '../jobs/queue'
import { refusal } from '../lib/errors'

/** The replies page (docs/plan.md, slice 11): the persona's replies by where they stand, and today's budget. */
export const list = query({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) return null
    const base = {
      persona: { _id: persona._id, name: persona.name, handle: persona.handle, autoPublish: persona.autoPublish, paused: persona.paused },
    }
    if (!platformsOf(persona).includes('x')) return { ...base, onX: false as const }
    return { ...base, onX: true as const, ...(await repliesView(ctx, persona, Date.now())) }
  },
})

/** The operator posts one reply, as written or edited: one click, one reply, within the budget. */
export const post = mutation({
  args: { replyId: v.id('replies'), text: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await postReplyNow(ctx, args.replyId, args.text, Date.now())
  },
})

/** The operator passes on a reply that has not gone out. */
export const skip = mutation({
  args: { replyId: v.id('replies') },
  handler: async (ctx, args): Promise<void> => {
    await skipReply(ctx, args.replyId)
  },
})

/** The operator asks for a reply to a post the persona passed on; the writer drafts one for them. */
export const ask = mutation({
  args: { replyId: v.id('replies') },
  handler: async (ctx, args): Promise<void> => {
    await askForReply(ctx, args.replyId)
  },
})

/** Listen now instead of at the next three-hour sweep. */
export const listenNow = mutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    if (!listens(persona)) throw refusal(`${persona.name} answers nobody on X: give it X and a reply budget above 0 first.`)
    return enqueueJob(ctx, { kind: 'listen_x', payload: { personaId: persona._id }, personaId: persona._id })
  },
})
