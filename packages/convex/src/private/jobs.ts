import { v } from 'convex/values'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'

export const recent = query({
  args: { personaId: v.optional(v.id('personas')) },
  handler: async (ctx, args) => {
    if (args.personaId)
      return ctx.db
        .query('jobs')
        .withIndex('by_persona', (q) => q.eq('personaId', args.personaId))
        .order('desc')
        .take(50)
    return ctx.db.query('jobs').order('desc').take(50)
  },
})

export const retry = mutation({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<Id<'jobs'>> => ctx.runMutation(internal.internal.dispatch.retryJob, { jobId: args.jobId }),
})
