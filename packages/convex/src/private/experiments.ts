import { v } from 'convex/values'
import { variantRate } from '@influstep/shared'
import { mutation, query } from '../_generated/server'
import { variantStatsFor } from '../internal/agents'
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
    if (args.variants.length < 2) throw new Error('an experiment needs at least two variants')
    const keys = new Set(args.variants.map((variant) => variant.key))
    if (keys.size !== args.variants.length) throw new Error('variant keys must be unique')
    const running = await ctx.db
      .query('experiments')
      .withIndex('by_persona_status', (q) => q.eq('personaId', args.personaId).eq('status', 'running'))
      .first()
    if (running) throw new Error(`"${running.name}" is still running; stop it first so episodes carry one variant`)
    return ctx.db.insert('experiments', { ...args, status: 'running', createdAt: Date.now() })
  },
})

export const stop = mutation({
  args: { experimentId: v.id('experiments') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.experimentId, { status: 'stopped' })
  },
})

/** The operator's own verdict, recorded as such. */
export const override = mutation({
  args: { experimentId: v.id('experiments'), winnerKey: v.string(), note: v.string() },
  handler: async (ctx, args) => {
    const experiment = await ctx.db.get(args.experimentId)
    if (!experiment) throw new Error('experiment not found')
    if (!experiment.variants.some((variant) => variant.key === args.winnerKey)) throw new Error(`no variant "${args.winnerKey}"`)
    await ctx.db.patch(experiment._id, {
      status: 'decided',
      decision: { winnerKey: args.winnerKey, lift: 0, confidence: 0, note: args.note, decidedAt: Date.now(), byOperator: true },
    })
  },
})
