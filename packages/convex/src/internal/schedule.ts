import { SIGNAL_TTL_MS } from '@influstep/shared'
import { internalMutation } from '../_generated/server'
import { addDays, dayKey, weekStart } from '../core/dates'
import { queueDueScripts } from '../core/episodes'
import { listens } from '../core/formats'
import { enqueueJob } from '../jobs/queue'

/** One job per active persona for each cron, so every run shows up in the jobs table. */

export const pollSignals = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const persona of await activePersonas(ctx)) {
      await enqueueJob(ctx, { kind: 'poll_signals', payload: { personaId: persona._id }, personaId: persona._id })
    }
  },
})

export const pollComments = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const persona of await activePersonas(ctx)) {
      await enqueueJob(ctx, { kind: 'poll_comments', payload: { personaId: persona._id }, personaId: persona._id })
    }
  },
})

/** The researcher's morning: poll the sources, log repeated questions as problems, write the daily brief. */
export const morningSweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const persona of await activePersonas(ctx)) {
      await enqueueJob(ctx, { kind: 'morning_sweep', payload: { personaId: persona._id }, personaId: persona._id })
    }
  },
})

/**
 * Tomorrow's scripts, after the sweep (core `queueDueScripts`): no args, so
 * `npx convex run internal/schedule:writeDueScripts` runs it by hand.
 */
export const writeDueScripts = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ queued: number; failed: number }> => {
    const now = Date.now()
    let queued = 0
    let failed = 0
    for (const persona of await activePersonas(ctx)) {
      const outcome = await queueDueScripts(ctx, persona, now)
      queued += outcome.queued
      failed += outcome.failed
    }
    return { queued, failed }
  },
})

/** The listener's sweep for every active persona that answers people on X (a reply budget above zero). */
export const listenOnX = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const persona of await activePersonas(ctx)) {
      if (!listens(persona)) continue
      await enqueueJob(ctx, { kind: 'listen_x', payload: { personaId: persona._id }, personaId: persona._id })
    }
  },
})

export const pullMetrics = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const persona of await activePersonas(ctx)) {
      await enqueueJob(ctx, { kind: 'pull_metrics', payload: { personaId: persona._id }, personaId: persona._id })
    }
  },
})

export const planNextWeek = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const persona of await activePersonas(ctx)) {
      const nextMonday = addDays(weekStart(dayKey(Date.now(), persona.timezone)), 7)
      await enqueueJob(ctx, { kind: 'plan_week', payload: { personaId: persona._id, weekStart: nextMonday }, personaId: persona._id })
    }
  },
})

/** The weekly strategy review, queued before the week is planned so the plan follows the fresh strategy. */
export const reviewStrategies = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const persona of await activePersonas(ctx)) {
      await enqueueJob(ctx, { kind: 'review_strategy', payload: { personaId: persona._id }, personaId: persona._id })
    }
  },
})

export const ageOutSignals = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SIGNAL_TTL_MS
    const old = await ctx.db
      .query('signals')
      .withIndex('by_found', (q) => q.lt('foundAt', cutoff))
      .collect()
    for (const signal of old) if (signal.status !== 'used') await ctx.db.delete(signal._id)
  },
})

async function activePersonas(ctx: Parameters<typeof enqueueJob>[0]) {
  const personas = await ctx.db.query('personas').collect()
  return personas.filter((persona) => !persona.paused)
}
