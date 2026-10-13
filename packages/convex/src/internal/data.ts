import { v } from 'convex/values'
import { VOICE_EXAMPLES_MAX, canTransition, isPost, type EpisodeStatus } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import { internalMutation, internalQuery, type MutationCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import { deleteHistoryPage as deleteHistoryPageRule, examplePostsOf } from '../core/account'
import { transition, type PipelineEvent } from '../core/pipeline'
import { workspaceOf } from '../core/workspace'
import { episodeStatusValidator } from '../lib/validators'

/**
 * Internal reads and writes the agent actions use, and the pages of Clear
 * history the scheduler runs. Actions cannot touch the database, so every
 * fact they need and every change they make goes through here. Domain rules
 * stay in core/.
 */

export const getJob = internalQuery({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<Doc<'jobs'> | null> => ctx.db.get(args.jobId),
})

export const getPersona = internalQuery({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<{ persona: Doc<'personas'>; workspace: Doc<'workspaces'> }> => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    const workspace = await workspaceOf(ctx, persona)
    return { persona, workspace }
  },
})

export interface EpisodeContext {
  episode: Doc<'episodes'>
  persona: Doc<'personas'>
  workspace: Doc<'workspaces'>
  directives: Doc<'directives'>[]
  signals: Doc<'signals'>[]
  experiment: Doc<'experiments'> | null
  /** The account posts the operator or the analyst marked as examples of the voice, most engaging first; only read for a post. */
  examples: Doc<'accountPosts'>[]
  /** The persona's active learnings, newest first, at most WRITER_LEARNINGS_MAX, for the writer's prompt. */
  learnings: string[]
}

/** How many learnings the writer reads, so its prompt stays short; one active learning per dimension keeps it well under. */
const WRITER_LEARNINGS_MAX = 10

export const getEpisodeContext = internalQuery({
  args: { episodeId: v.id('episodes') },
  handler: async (ctx, args): Promise<EpisodeContext> => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) throw new Error(`episode ${args.episodeId} not found`)
    const persona = await ctx.db.get(episode.personaId)
    if (!persona) throw new Error(`persona ${episode.personaId} not found`)
    const workspace = await workspaceOf(ctx, persona)
    const directives = await ctx.db
      .query('directives')
      .withIndex('by_persona_active', (q) => q.eq('personaId', persona._id).eq('active', true))
      .collect()
    const signals = (await Promise.all(episode.signalIds.map((id) => ctx.db.get(id)))).filter(
      (signal): signal is Doc<'signals'> => signal !== null
    )
    const experiment = episode.experimentId ? await ctx.db.get(episode.experimentId) : null
    // setExample caps the marks at VOICE_EXAMPLES_MAX; the cap holds here too, so the writer's prompt stays short.
    const examples = isPost(episode.kind) ? (await examplePostsOf(ctx, persona._id)).slice(0, VOICE_EXAMPLES_MAX) : []
    const learnings = (
      await ctx.db
        .query('memories')
        .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'active'))
        .collect()
    )
      .filter((memory) => memory.kind === 'learning')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, WRITER_LEARNINGS_MAX)
      .map((memory) => memory.text)
    return { episode, persona, workspace, directives, signals, experiment, examples, learnings }
  },
})

/** Moves an episode through the pipeline or throws with the reason. */
export async function applyEvent(
  ctx: MutationCtx,
  episodeId: Id<'episodes'>,
  event: PipelineEvent,
  previous?: EpisodeStatus
): Promise<EpisodeStatus> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  const result = transition(episode.status, event, { kind: episode.kind, previous })
  if (!result.ok) throw new Error(result.reason)
  await ctx.db.patch(episodeId, {
    status: result.status,
    error: event.type === 'failed' ? event.error : undefined,
    updatedAt: Date.now(),
  })
  return result.status
}

/** Fails the episode when its status allows it; a measured or killed episode keeps its state. */
export async function failEpisodeIfPossible(ctx: MutationCtx, episodeId: Id<'episodes'>, error: string): Promise<void> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) return
  if (!canTransition(episode.status, 'failed')) return
  await applyEvent(ctx, episodeId, { type: 'failed', error })
}

export const failEpisode = internalMutation({
  args: { episodeId: v.id('episodes'), error: v.string() },
  handler: async (ctx, args) => failEpisodeIfPossible(ctx, args.episodeId, args.error),
})

export const setEpisodeStatus = internalMutation({
  args: { episodeId: v.id('episodes'), status: episodeStatusValidator },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.episodeId, { status: args.status, updatedAt: Date.now() })
  },
})

/**
 * The pages of Clear history after the first (private/account.ts,
 * clearHistory): each deletes one page in its own mutation, so a history of
 * any size stays inside a mutation's write limit, and queues the next until
 * none is left.
 */
export const deleteHistoryPage = internalMutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<void> => {
    const page = await deleteHistoryPageRule(ctx, args.personaId)
    if (page.more) await ctx.scheduler.runAfter(0, internal.internal.data.deleteHistoryPage, { personaId: args.personaId })
  },
})
