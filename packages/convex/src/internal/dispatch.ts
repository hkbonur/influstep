import { v } from 'convex/values'
import type { JobKind } from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { internalAction, internalMutation, type ActionCtx } from '../_generated/server'
import { enqueueJob, markDone, markFailed, markRunning } from '../jobs/queue'

/**
 * Runs one backend job. Every agent action is reached from here, so a job's
 * row carries what happened: running, done with a result, or failed with the
 * error. An episode-bound job that fails also fails the episode.
 */

const BACKEND_RUNNERS: Partial<Record<JobKind, (ctx: ActionCtx, payload: unknown) => Promise<unknown>>> = {
  poll_signals: (ctx, payload) => ctx.runAction(internal.internal.agents.pollSignals, payloadWith(payload, 'personaId')),
  plan_week: (ctx, payload) => ctx.runAction(internal.internal.agents.planWeek, payloadWith(payload, 'personaId', 'weekStart')),
  write_script: (ctx, payload) => ctx.runAction(internal.internal.agents.writeScript, payloadWith(payload, 'episodeId')),
  poll_comments: (ctx, payload) => ctx.runAction(internal.internal.agents.pollComments, payloadWith(payload, 'personaId')),
  pull_metrics: (ctx, payload) => ctx.runAction(internal.internal.agents.pullMetrics, payloadWith(payload, 'personaId')),
  evaluate_experiments: (ctx, payload) => ctx.runAction(internal.internal.agents.evaluateExperiments, payloadWith(payload, 'personaId')),
  import_x_history: (ctx, payload) => ctx.runAction(internal.internal.agents.importXHistory, payloadWith(payload, 'personaId')),
  learn_voice: (ctx, payload) => ctx.runAction(internal.internal.agents.learnVoice, payloadWith(payload, 'personaId')),
}

// Payloads are stored as v.any(); narrow them here, at the boundary, by the keys each agent needs.
function payloadWith<K extends string>(payload: unknown, ...keys: K[]): Record<K, string> {
  if (typeof payload !== 'object' || payload === null) throw new Error('job payload is not an object')
  const record = payload as Record<string, unknown>
  const out: Partial<Record<K, string>> = {}
  for (const key of keys) {
    const value = record[key]
    if (typeof value !== 'string') throw new Error(`job payload is missing "${key}"`)
    out[key] = value
  }
  return out as Record<K, string>
}

export const runBackendJob = internalAction({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.runQuery(internal.internal.data.getJob, { jobId: args.jobId })
    if (!job) throw new Error(`job ${args.jobId} not found`)
    if (job.status !== 'queued') return
    const run = BACKEND_RUNNERS[job.kind]
    if (!run) throw new Error(`job kind ${job.kind} does not run on the backend`)
    await ctx.runMutation(internal.internal.dispatch.setRunning, { jobId: args.jobId })
    try {
      const result = await run(ctx, job.payload)
      await ctx.runMutation(internal.internal.dispatch.setDone, { jobId: args.jobId, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await ctx.runMutation(internal.internal.dispatch.setFailed, { jobId: args.jobId, error: message })
      if (job.episodeId) await ctx.runMutation(internal.internal.data.failEpisode, { episodeId: job.episodeId, error: message })
    }
  },
})

export const setRunning = internalMutation({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args) => markRunning(ctx, args.jobId),
})

export const setDone = internalMutation({
  args: { jobId: v.id('jobs'), result: v.any() },
  handler: async (ctx, args) => markDone(ctx, args.jobId, args.result),
})

export const setFailed = internalMutation({
  args: { jobId: v.id('jobs'), error: v.string() },
  handler: async (ctx, args) => markFailed(ctx, args.jobId, args.error),
})

/** Retry a failed job: a fresh row with the same payload, so the audit trail keeps the failure. */
export const retryJob = internalMutation({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<Id<'jobs'>> => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    return enqueueJob(ctx, { kind: job.kind, payload: job.payload, personaId: job.personaId, episodeId: job.episodeId })
  },
})
