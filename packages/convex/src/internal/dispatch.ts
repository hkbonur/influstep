import { v } from 'convex/values'
import { isChatTask, type JobKind } from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { internalAction, internalMutation, type ActionCtx } from '../_generated/server'
import { reportChatTaskFailure } from '../core/chat'
import { enqueueJob, markDone, markFailed, markRunning } from '../jobs/queue'
import { refusal } from '../lib/errors'

/**
 * Runs one backend job. Every agent action is reached from here, so a job's
 * row carries what happened: running, done with a result, or failed with the
 * error. An episode-bound job that fails also fails the episode; a chat task
 * that fails says so in the chat it was asked in.
 */

const BACKEND_RUNNERS: Partial<Record<JobKind, (ctx: ActionCtx, job: Doc<'jobs'>) => Promise<unknown>>> = {
  poll_signals: (ctx, job) => ctx.runAction(internal.internal.agents.pollSignals, payloadWith(job.payload, 'personaId')),
  plan_week: (ctx, job) => ctx.runAction(internal.internal.agents.planWeek, payloadWith(job.payload, 'personaId', 'weekStart')),
  write_script: (ctx, job) => ctx.runAction(internal.internal.agents.writeScript, payloadWith(job.payload, 'episodeId')),
  poll_comments: (ctx, job) => ctx.runAction(internal.internal.agents.pollComments, payloadWith(job.payload, 'personaId')),
  pull_metrics: (ctx, job) => ctx.runAction(internal.internal.agents.pullMetrics, payloadWith(job.payload, 'personaId')),
  evaluate_experiments: (ctx, job) => ctx.runAction(internal.internal.agents.evaluateExperiments, payloadWith(job.payload, 'personaId')),
  import_x_history: (ctx, job) => ctx.runAction(internal.internal.agents.importXHistory, payloadWith(job.payload, 'personaId')),
  learn_voice: (ctx, job) => ctx.runAction(internal.internal.agents.learnVoice, payloadWith(job.payload, 'personaId')),
  // A chat task reads its persona, its topic and the message it answers from its own row.
  research_brief: (ctx, job) => ctx.runAction(internal.internal.agents.researchBrief, { jobId: job._id }),
  comment_digest: (ctx, job) => ctx.runAction(internal.internal.agents.commentDigest, { jobId: job._id }),
  analytics_summary: (ctx, job) => ctx.runAction(internal.internal.agents.analyticsSummary, { jobId: job._id }),
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
      const result = await run(ctx, job)
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
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    await markFailed(ctx, args.jobId, args.error)
    // The task's own action posts nothing when it throws, so this is the one failure message.
    if (isChatTask(job.kind)) await reportChatTaskFailure(ctx, job, args.error)
  },
})

/**
 * Retry a failed job: a fresh row with the same payload, so the audit trail
 * keeps the failure. Nothing of a killed episode runs again, its uploads least
 * of all. An upload is never retried as a job: its old payload carries the
 * description composed back then, and its publication is no longer uploading,
 * so the episode's own retry sends it again through dispatch instead.
 */
export const retryJob = internalMutation({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<Id<'jobs'>> => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    if (job.episodeId !== undefined) {
      const episode = await ctx.db.get(job.episodeId)
      if (!episode) throw new Error(`episode ${job.episodeId} of job ${job._id} not found`)
      if (episode.status === 'killed') throw refusal(`"${episode.title}" was killed; its jobs do not run again.`)
      if (job.kind === 'publish') throw refusal(`An upload goes out again with its episode: retry "${episode.title}" instead.`)
    }
    // Dispatch gives every upload its episode, so one without it is a bug, never something to send again.
    if (job.kind === 'publish') throw new Error(`publish job ${job._id} has no episode`)
    return enqueueJob(ctx, {
      kind: job.kind,
      payload: job.payload,
      personaId: job.personaId,
      episodeId: job.episodeId,
      messageId: job.messageId,
    })
  },
})
