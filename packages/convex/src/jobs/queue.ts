import { JOB_KINDS, type JobKind } from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/**
 * The one place a job is created. Backend jobs are scheduled right away;
 * runner jobs wait in the queue until the runner claims them over HTTP.
 */
export async function enqueueJob(
  ctx: MutationCtx,
  args: {
    kind: JobKind
    payload: unknown
    personaId?: Id<'personas'>
    episodeId?: Id<'episodes'>
    /** The operator's chat message that asked for the job, for a chat task. */
    messageId?: Id<'messages'>
  }
): Promise<Id<'jobs'>> {
  const meta = JOB_KINDS[args.kind]
  const jobId = await ctx.db.insert('jobs', {
    kind: args.kind,
    role: meta.role,
    runsOn: meta.runsOn,
    status: 'queued',
    personaId: args.personaId,
    episodeId: args.episodeId,
    messageId: args.messageId,
    payload: args.payload,
    attempts: 0,
    createdAt: Date.now(),
  })
  if (meta.runsOn === 'backend') {
    await ctx.scheduler.runAfter(0, internal.internal.dispatch.runBackendJob, { jobId })
  }
  return jobId
}

export async function markRunning(ctx: MutationCtx, jobId: Id<'jobs'>): Promise<void> {
  const job = await ctx.db.get(jobId)
  if (!job) throw new Error(`job ${jobId} not found`)
  await ctx.db.patch(jobId, { status: 'running', startedAt: Date.now(), attempts: job.attempts + 1 })
}

export async function markDone(ctx: MutationCtx, jobId: Id<'jobs'>, result: unknown): Promise<void> {
  await ctx.db.patch(jobId, { status: 'done', result, finishedAt: Date.now(), error: undefined })
}

export async function markFailed(ctx: MutationCtx, jobId: Id<'jobs'>, error: string): Promise<void> {
  await ctx.db.patch(jobId, { status: 'failed', error, finishedAt: Date.now() })
}
