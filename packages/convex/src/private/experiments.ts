import { v } from 'convex/values'
import { variantRate } from '@influstep/shared'
import { mutation, query } from '../_generated/server'
import { applyExperimentDecision, startExperiment, stopExperiment, variantStatsFor } from '../core/experiments'
import { experimentKindValidator, metricKeyValidator, variantValidator } from '../lib/validators'

export const list = query({
  args: { personaId: v.optional(v.id('personas')) },
  handler: async (ctx, args) => {
    const all = await ctx.db.query('experiments').collect()
    const out = []
    for (const experiment of all) {
      if (args.personaId && experiment.personaId !== args.personaId) continue
      const persona = await ctx.db.get(experiment.personaId)
      const stats = await variantStatsFor(ctx, experiment)
      out.push({
        ...experiment,
        // Rows from before the strategy review were all set up by the operator, so an absent value means the operator.
        createdBy: experiment.createdBy ?? ('operator' as const),
        personaName: persona?.name ?? '',
        personaHandle: persona?.handle ?? '',
        stats: stats.map((stat) => ({ ...stat, rate: variantRate(stat) })),
      })
    }
    return out.sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === 'running' ? -1 : 1))
  },
})

export const create = mutation({
  args: {
    personaId: v.id('personas'),
    name: v.string(),
    hypothesis: v.string(),
    kind: experimentKindValidator,
    metric: metricKeyValidator,
    variants: v.array(variantValidator),
    minExposures: v.number(),
    minConfidence: v.number(),
  },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    return startExperiment(ctx, persona, {
      name: args.name,
      hypothesis: args.hypothesis,
      kind: args.kind,
      metric: args.metric,
      variants: args.variants,
      minExposures: args.minExposures,
      minConfidence: args.minConfidence,
      createdBy: 'operator',
      // The operator's reason for an experiment is the hypothesis they wrote.
      reason: args.hypothesis,
    })
  },
})

export const stop = mutation({
  args: { experimentId: v.id('experiments') },
  handler: async (ctx, args) => {
    await stopExperiment(ctx, args.experimentId, 'operator')
  },
})

/** The operator's own verdict, recorded as such: it lands like the analyst's, with no lift and no confidence of its own. */
export const override = mutation({
  args: { experimentId: v.id('experiments'), winnerKey: v.string(), note: v.string() },
  handler: async (ctx, args) => {
    const experiment = await ctx.db.get(args.experimentId)
    if (!experiment) throw new Error('experiment not found')
    await applyExperimentDecision(ctx, experiment, { winnerKey: args.winnerKey, lift: 0, confidence: 0 }, 'operator', args.note)
  },
})
