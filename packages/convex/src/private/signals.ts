import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { createIdea } from '../core/episodes'
import { sponsorSegmentValidator } from '../lib/validators'

export const list = query({
  args: { personaId: v.optional(v.id('personas')) },
  handler: async (ctx, args) => {
    const personas = new Map((await ctx.db.query('personas').collect()).map((persona) => [persona._id, persona]))
    const signals = await ctx.db.query('signals').withIndex('by_found').order('desc').take(200)
    return signals
      .filter((signal) => !args.personaId || signal.personaId === args.personaId)
      .map((signal) => ({
        ...signal,
        personaName: personas.get(signal.personaId)?.name ?? '',
        personaHandle: personas.get(signal.personaId)?.handle ?? '',
      }))
  },
})

export const dismiss = mutation({
  args: { signalId: v.id('signals') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.signalId, { status: 'dismissed' })
  },
})

/** One click from a signal to an idea the writer picks up right away. */
export const makeEpisode = mutation({
  args: { signalId: v.id('signals'), plannedFor: v.string(), sponsorSegment: v.optional(sponsorSegmentValidator) },
  handler: async (ctx, args) => {
    const signal = await ctx.db.get(args.signalId)
    if (!signal) throw new Error('signal not found')
    const persona = await ctx.db.get(signal.personaId)
    if (!persona) throw new Error('persona not found')
    const pillar =
      persona.pillars.find((candidate) => signal.topics.some((topic) => candidate.toLowerCase().includes(topic.toLowerCase()))) ??
      persona.pillars[0] ??
      ''
    return createIdea(ctx, persona, {
      personaId: persona._id,
      plannedFor: args.plannedFor,
      concept: `React to: ${signal.title}`,
      pillar,
      sponsorSegment: args.sponsorSegment ?? 'none',
      signalIds: [signal._id],
    })
  },
})
