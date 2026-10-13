import { v } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import { strategyView } from '../core/strategy'
import { enqueueJob } from '../jobs/queue'
import { refusal } from '../lib/errors'

/** What the strategy page reads beside the persona and its experiments: its learnings, its journal and its newest review job. */
export const get = query({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) return null
    return strategyView(ctx, persona)
  },
})

/** Review the persona's strategy now rather than on Monday. One review at a time per persona. */
export const reviewNow = mutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<Id<'jobs'>> => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
      .collect()
    const pending = jobs.find((job) => job.kind === 'review_strategy' && (job.status === 'queued' || job.status === 'running'))
    if (pending) throw refusal(`${persona.name} is already reviewing the strategy.`)
    return enqueueJob(ctx, { kind: 'review_strategy', payload: { personaId: persona._id }, personaId: persona._id })
  },
})
