import { v } from 'convex/values'
import { PLATFORM_ASPECT, produceResultSchema, publishResultSchema, type RunnerJob } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import { internalMutation, internalQuery } from '../_generated/server'
import { completeProduction, completePublication, failPublication, startProduction } from '../core/episodes'
import { enqueueJob, markDone, markFailed, markRunning } from '../jobs/queue'
import { applyEvent, failEpisodeIfPossible } from './data'

/**
 * What the runner can do over HTTP (http.ts): claim the next runner job, say
 * it is alive, report a job's result or failure. Results are validated with
 * the shared zod contracts before the domain sees them.
 */

export const claimNext = internalMutation({
  args: { runnerName: v.string() },
  handler: async (ctx, args): Promise<RunnerJob | null> => {
    const job = await ctx.db
      .query('jobs')
      .withIndex('by_runtime_status', (q) => q.eq('runsOn', 'runner').eq('status', 'queued'))
      .order('asc')
      .first()
    if (!job) return null
    if (job.personaId) {
      const persona = await ctx.db.get(job.personaId)
      // A paused persona's jobs wait in the queue; nothing is lost (CONTEXT.md, "Pause").
      if (persona?.paused && job.kind !== 'open_browser') return null
    }
    await markRunning(ctx, job._id)
    const runner = await ctx.db
      .query('runners')
      .withIndex('by_name', (q) => q.eq('name', args.runnerName))
      .first()
    if (runner) await ctx.db.patch(runner._id, { currentJobId: job._id, lastSeenAt: Date.now() })
    return toRunnerJob(job)
  },
})

function toRunnerJob(job: Doc<'jobs'>): RunnerJob {
  if (job.kind === 'produce') return { id: job._id, kind: 'produce', payload: job.payload }
  if (job.kind === 'publish') return { id: job._id, kind: 'publish', payload: job.payload }
  if (job.kind === 'open_browser') return { id: job._id, kind: 'open_browser', payload: job.payload }
  throw new Error(`job kind ${job.kind} does not run on the runner`)
}

export const heartbeat = internalMutation({
  args: { name: v.string(), version: v.string(), providersMode: v.string() },
  handler: async (ctx, args) => {
    const runner = await ctx.db
      .query('runners')
      .withIndex('by_name', (q) => q.eq('name', args.name))
      .first()
    if (runner) {
      await ctx.db.patch(runner._id, { version: args.version, providersMode: args.providersMode, lastSeenAt: Date.now() })
      return
    }
    await ctx.db.insert('runners', { name: args.name, version: args.version, providersMode: args.providersMode, lastSeenAt: Date.now() })
  },
})

export const complete = internalMutation({
  args: { jobId: v.id('jobs'), result: v.any() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    if (job.status !== 'running') throw new Error(`job ${args.jobId} is ${job.status}, not running`)
    if (job.kind === 'produce') {
      const result = produceResultSchema.parse(args.result)
      if (!job.episodeId) throw new Error('produce job has no episode')
      await completeProduction(ctx, job.episodeId, result)
    } else if (job.kind === 'publish') {
      const result = publishResultSchema.parse(args.result)
      await completePublication(ctx, job.payload.publicationId as Id<'publications'>, result)
    }
    await markDone(ctx, args.jobId, args.result)
    await clearRunnerJob(ctx, args.jobId)
  },
})

export const fail = internalMutation({
  args: { jobId: v.id('jobs'), error: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    await markFailed(ctx, args.jobId, args.error)
    await clearRunnerJob(ctx, args.jobId)
    if (job.kind === 'publish') {
      await failPublication(ctx, job.payload.publicationId as Id<'publications'>, args.error)
      return
    }
    if (job.episodeId) await failEpisodeIfPossible(ctx, job.episodeId, args.error)
  },
})

async function clearRunnerJob(ctx: Parameters<typeof markDone>[0], jobId: Id<'jobs'>): Promise<void> {
  const runners = await ctx.db.query('runners').collect()
  for (const runner of runners)
    if (runner.currentJobId === jobId) await ctx.db.patch(runner._id, { currentJobId: undefined, lastSeenAt: Date.now() })
}

export const latest = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<'runners'> | null> => {
    const runners = await ctx.db.query('runners').collect()
    return runners.sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] ?? null
  },
})

/**
 * Publications whose time has come become publish jobs (crons.ts, every five
 * minutes). The render URL is resolved here so the runner needs no storage
 * access of its own.
 */
export const dispatchDuePublications = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ dispatched: number }> => {
    const now = args.now ?? Date.now()
    const due = await ctx.db
      .query('publications')
      .withIndex('by_status_scheduled', (q) => q.eq('status', 'queued').lte('scheduledAt', now))
      .collect()
    let dispatched = 0
    for (const publication of due) {
      const episode = await ctx.db.get(publication.episodeId)
      if (!episode || episode.status !== 'scheduled') continue
      const persona = await ctx.db.get(publication.personaId)
      if (!persona || persona.paused) continue
      const render = episode.renders.find((candidate) => candidate.aspect === PLATFORM_ASPECT[publication.platform])
      if (!render) {
        await failPublication(ctx, publication._id, `no ${PLATFORM_ASPECT[publication.platform]} render`)
        continue
      }
      const renderUrl = await ctx.storage.getUrl(render.storageId)
      if (!renderUrl) {
        await failPublication(ctx, publication._id, 'render file is missing from storage')
        continue
      }
      await ctx.db.patch(publication._id, { status: 'uploading' })
      await enqueueJob(ctx, {
        kind: 'publish',
        personaId: persona._id,
        episodeId: episode._id,
        payload: {
          publicationId: publication._id,
          platform: publication.platform,
          title: publication.title,
          description: publication.description,
          renderStorageId: render.storageId,
          renderUrl,
          scheduledAt: publication.scheduledAt,
        },
      })
      dispatched += 1
    }
    return { dispatched }
  },
})

/** A checklist item is done: the host is signed in, and the episode it blocked resumes. */
export const resumeBlockedEpisode = internalMutation({
  args: { episodeId: v.id('episodes') },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode || episode.status !== 'waiting_on_you') return
    const open = await ctx.db
      .query('checklistItems')
      .withIndex('by_episode', (q) => q.eq('episodeId', args.episodeId))
      .filter((q) => q.eq(q.field('status'), 'open'))
      .first()
    if (open) return
    const persona = await ctx.db.get(episode.personaId)
    if (!persona) throw new Error(`persona ${episode.personaId} not found`)
    await applyEvent(ctx, args.episodeId, { type: 'unblocked' })
    await startProduction(ctx, episode, persona)
  },
})
