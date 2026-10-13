import { v } from 'convex/values'
import {
  RUNNER_STALE_MS,
  X_POST_LIMIT,
  isPost,
  produceResultSchema,
  publishResultSchema,
  xLength,
  type AspectRatio,
  postReplyPayloadSchema,
  type PublishPayload,
  type RunnerJob,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from '../_generated/server'
import { composeDescription, descriptionFormatOf } from '../core/attribution'
import { activeDiscountCodeFor } from '../core/discounts'
import { KILLED_BEFORE_RUN, completeProduction, completePublication, failPublication, startProduction } from '../core/episodes'
import { episodeVariant } from '../core/experiments'
import { latestRunner } from '../core/jobs'
import { completeReply, failReply } from '../core/replies'
import { logRecordingProblem } from '../core/research'
import { workspaceOf } from '../core/workspace'
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
    await requeueOrphanedJobs(ctx, Date.now())
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

/**
 * A running runner job goes back to the queue when no runner process has said
 * it is still on it for RUNNER_STALE_MS: the process holding it crashed,
 * stopped or restarted. Liveness is per job, not per runner name, because two
 * processes can share a name (RUNNER_NAME defaults to "runner"), and a rule by
 * name would hand a live process's job to its twin and run it twice. A
 * running job without a start time has no sign of life at all, so it goes
 * back too. The claim that picks the job up again counts the attempt. An
 * orphan whose episode was killed meanwhile fails instead, like every queued
 * job of a killed episode, so its render is not recorded again for nothing.
 */
async function requeueOrphanedJobs(ctx: MutationCtx, now: number): Promise<void> {
  const running = await ctx.db
    .query('jobs')
    .withIndex('by_runtime_status', (q) => q.eq('runsOn', 'runner').eq('status', 'running'))
    .collect()
  if (running.length === 0) return
  const runners = await ctx.db.query('runners').collect()
  for (const job of running) {
    const lastSign = job.aliveAt ?? job.startedAt
    if (lastSign !== undefined && now - lastSign < RUNNER_STALE_MS) continue
    if (await episodeKilled(ctx, job)) await markFailed(ctx, job._id, KILLED_BEFORE_RUN)
    else await ctx.db.patch(job._id, { status: 'queued', startedAt: undefined, aliveAt: undefined })
    // Only the job pointer goes: the holder said nothing, so its last seen time stays as it was.
    for (const runner of runners) if (runner.currentJobId === job._id) await ctx.db.patch(runner._id, { currentJobId: undefined })
  }
}

/** Whether the job's episode was killed; a job that serves no episode has none to kill. */
async function episodeKilled(ctx: MutationCtx, job: Doc<'jobs'>): Promise<boolean> {
  if (job.episodeId === undefined) return false
  const episode = await ctx.db.get(job.episodeId)
  if (!episode) throw new Error(`episode ${job.episodeId} of job ${job._id} not found`)
  return episode.status === 'killed'
}

function toRunnerJob(job: Doc<'jobs'>): RunnerJob {
  if (job.kind === 'produce') return { id: job._id, kind: 'produce', payload: job.payload }
  if (job.kind === 'publish') return { id: job._id, kind: 'publish', payload: job.payload }
  if (job.kind === 'open_browser') return { id: job._id, kind: 'open_browser', payload: job.payload }
  if (job.kind === 'post_reply') return { id: job._id, kind: 'post_reply', payload: job.payload }
  throw new Error(`job kind ${job.kind} does not run on the runner`)
}

export const heartbeat = internalMutation({
  // jobId is the job this process is running right now, or null when it is idle.
  args: { name: v.string(), version: v.string(), providersMode: v.string(), jobId: v.union(v.id('jobs'), v.null()) },
  handler: async (ctx, args) => {
    const now = Date.now()
    if (args.jobId) {
      const job = await ctx.db.get(args.jobId)
      // A job requeued or finished meanwhile is no longer this process's; its own complete or fail call says so.
      if (job?.status === 'running') await ctx.db.patch(job._id, { aliveAt: now })
    }
    const runner = await ctx.db
      .query('runners')
      .withIndex('by_name', (q) => q.eq('name', args.name))
      .first()
    if (runner) {
      await ctx.db.patch(runner._id, { version: args.version, providersMode: args.providersMode, lastSeenAt: now })
      return
    }
    await ctx.db.insert('runners', { name: args.name, version: args.version, providersMode: args.providersMode, lastSeenAt: now })
  },
})

export const complete = internalMutation({
  args: { jobId: v.id('jobs'), result: v.any() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    if (job.status !== 'running') throw new Error(`job ${args.jobId} is ${job.status}, not running`)
    let stored: unknown = args.result
    if (job.kind === 'produce') {
      const result = produceResultSchema.parse(args.result)
      if (!job.episodeId) throw new Error('produce job has no episode')
      // A render of an episode killed meanwhile is set aside; the job still did its work, so it ends done and says why.
      if ((await completeProduction(ctx, job.episodeId, result)) === 'killed') stored = { skipped: 'killed' }
    } else if (job.kind === 'publish') {
      const result = publishResultSchema.parse(args.result)
      // An upload whose publication was withdrawn meanwhile stays withdrawn; the job keeps where it went, so it can be taken down.
      if ((await completePublication(ctx, job.payload.publicationId as Id<'publications'>, result)) === 'withdrawn')
        stored = { skipped: 'withdrawn', ...result }
    } else if (job.kind === 'post_reply') {
      const result = publishResultSchema.parse(args.result)
      await completeReply(ctx, postReplyPayloadSchema.parse(job.payload).replyId as Id<'replies'>, result)
    }
    await markDone(ctx, args.jobId, stored)
    await clearRunnerJob(ctx, args.jobId)
  },
})

/**
 * A runner job failed. A recording that broke on a screen shot names the shot
 * (`shotId`), so a tool that broke under the persona becomes a problem in its
 * problem log (core/research.ts) before the episode fails.
 */
export const fail = internalMutation({
  args: { jobId: v.id('jobs'), error: v.string(), shotId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    // A job that went back to the queue, or that another process finished, is not this caller's to fail.
    if (job.status !== 'running') throw new Error(`job ${args.jobId} is ${job.status}, not running`)
    await markFailed(ctx, args.jobId, args.error)
    await clearRunnerJob(ctx, args.jobId)
    if (job.kind === 'publish') {
      await failPublication(ctx, job.payload.publicationId as Id<'publications'>, args.error)
      return
    }
    if (job.kind === 'post_reply') {
      await failReply(ctx, postReplyPayloadSchema.parse(job.payload).replyId as Id<'replies'>, args.error)
      return
    }
    if (job.kind === 'produce' && job.episodeId && args.shotId !== undefined) {
      await logRecordingProblem(ctx, { episodeId: job.episodeId, shotId: args.shotId, error: args.error, now: Date.now() })
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
  handler: async (ctx): Promise<Doc<'runners'> | null> => latestRunner(ctx),
})

/**
 * Publications whose time has come become publish jobs (crons.ts, every five
 * minutes). Only a queued publication is due: a draft waits in its publish
 * package until the operator approves it. The render URL is resolved here so
 * the runner needs no storage access of its own, and the description is
 * composed here with the code in force at this moment, so the same patch that
 * hands the publication over stamps the code it went out with. A publication
 * that failed and is dispatched again is composed and stamped again. One that
 * cannot be handed over fails with the reason, and the rest go out.
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
      const built = await publishPayloadFor(ctx, { publication, episode, persona })
      if (!built.ok) {
        await failPublication(ctx, publication._id, built.error)
        continue
      }
      await ctx.db.patch(publication._id, { status: 'uploading', discountCodeId: built.value.discountCodeId })
      await enqueueJob(ctx, { kind: 'publish', personaId: persona._id, episodeId: episode._id, payload: built.value.payload })
      dispatched += 1
    }
    return { dispatched }
  },
})

type Built<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * What the runner uploads for one publication, and the code its description
 * carries. A video publication carries its title, its description composed
 * now (core/attribution.ts) and the render of its cut; a post publication
 * carries its parts exactly as written, with nothing appended, and, for an
 * image post, the card render its aspect names. Neither X text carries a code.
 */
async function publishPayloadFor(
  ctx: { db: QueryCtx['db']; storage: QueryCtx['storage'] },
  rows: { publication: Doc<'publications'>; episode: Doc<'episodes'>; persona: Doc<'personas'> }
): Promise<Built<{ payload: PublishPayload; discountCodeId: Id<'discountCodes'> | undefined }>> {
  const { publication, episode, persona } = rows
  if (isPost(episode.kind)) {
    if (publication.platform !== 'x') return { ok: false, error: `a post goes only to X, not ${publication.platform}` }
    if (!publication.parts) return { ok: false, error: 'the post publication has no parts' }
    const base = { kind: 'post' as const, publicationId: publication._id, platform: publication.platform, parts: publication.parts }
    if (!publication.aspect)
      return { ok: true, value: { payload: { ...base, scheduledAt: publication.scheduledAt }, discountCodeId: undefined } }
    const media = await renderOf(ctx, episode, publication.aspect)
    if (!media.ok) return media
    return {
      ok: true,
      value: {
        payload: { ...base, mediaStorageId: media.value.storageId, mediaUrl: media.value.url, scheduledAt: publication.scheduledAt },
        discountCodeId: undefined,
      },
    }
  }
  if (!publication.aspect) return { ok: false, error: 'the video publication has no cut' }
  // composeDescription treats both as broken invariants and throws; here they fail this publication alone.
  if (publication.platform === 'x' && xLength(publication.title) > X_POST_LIMIT)
    return { ok: false, error: `the title is ${xLength(publication.title)} characters; X allows ${X_POST_LIMIT}` }
  if (publication.platform !== 'x' && publication.body === undefined)
    return { ok: false, error: 'the video publication has no description' }
  const render = await renderOf(ctx, episode, publication.aspect)
  if (!render.ok) return render
  const link = await ctx.db.get(publication.linkId)
  if (!link) return { ok: false, error: 'the tracked link of the publication is missing' }
  const workspace = await workspaceOf(ctx, persona)
  // X carries the title alone, so no code is in it whatever is in force.
  const discountCode = publication.platform === 'x' ? null : await activeDiscountCodeFor(ctx, persona._id, episode._id)
  const experiment = episode.experimentId === undefined ? null : await ctx.db.get(episode.experimentId)
  const descriptionFormat = descriptionFormatOf(
    { variant: episodeVariant(episode, experiment), sponsorSegment: episode.sponsorSegment },
    persona.strategy?.defaults
  )
  return {
    ok: true,
    value: {
      payload: {
        kind: 'video',
        publicationId: publication._id,
        platform: publication.platform,
        title: publication.title,
        description: composeDescription({ workspace, episode, publication, linkSlug: link.slug, discountCode, descriptionFormat }),
        renderStorageId: render.value.storageId,
        renderUrl: render.value.url,
        scheduledAt: publication.scheduledAt,
      },
      discountCodeId: discountCode?._id,
    },
  }
}

/** The episode's render for one aspect and the URL the runner downloads it from. */
async function renderOf(
  ctx: { storage: QueryCtx['storage'] },
  episode: Doc<'episodes'>,
  aspect: AspectRatio
): Promise<Built<{ storageId: Id<'_storage'>; url: string }>> {
  const render = episode.renders.find((candidate) => candidate.aspect === aspect)
  if (!render) return { ok: false, error: `no ${aspect} render` }
  const url = await ctx.storage.getUrl(render.storageId)
  if (!url) return { ok: false, error: 'render file is missing from storage' }
  return { ok: true, value: { storageId: render.storageId, url } }
}

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
