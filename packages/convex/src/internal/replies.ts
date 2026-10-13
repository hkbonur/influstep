import { v } from 'convex/values'
import { X_POST_LIMIT, replyProblems } from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { internalAction, internalMutation, internalQuery, type ActionCtx } from '../_generated/server'
import { writerMemory, type WriterMemory } from '../core/memory'
import {
  REPLY_WRITES_PER_RUN,
  dispatchQueuedReplies,
  listens,
  repliesToMeasure,
  storeHeard,
  storeReplyCounts,
  storeWritten,
  type HeardOutcome,
  type WrittenReply,
} from '../core/replies'
import { workspaceOf } from '../core/workspace'
import { enqueueJob } from '../jobs/queue'
import { providersMode } from '../lib/env'
import { heardPostValidator, replyCountsValidator, writtenReplyValidator } from '../lib/validators'
import { engagementProvider } from '../providers/engagement'
import { llmProvider, type ReplyBrief, type ReplyDraft } from '../providers/llm'
import type { LlmProvider } from '../providers/llm/types'

/**
 * Engagement on X (docs/plan.md, slice 11): the listener's sweep (the
 * researcher), the writer's replies, the five-minute send of queued replies,
 * and the analyst's read of what sent replies brought back. The rules are in
 * core/replies.ts.
 */

/** The listener's sweep: what X says to and around the persona, kept where it is worth answering. */
export const listen = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, args): Promise<HeardOutcome | { skipped: string }> => {
    const personaId = args.personaId as Id<'personas'>
    const { persona, workspace } = await ctx.runQuery(internal.internal.data.getPersona, { personaId })
    if (!listens(persona)) return { skipped: 'replies are off' }
    const posts = await engagementProvider().listen({
      handle: persona.handle,
      niche: persona.niche,
      pillars: persona.pillars,
      sponsorName: workspace.sponsorName,
      now: Date.now(),
    })
    return ctx.runMutation(internal.internal.replies.storeHeardMutation, { personaId, posts, mock: providersMode() === 'mock' })
  },
})

/** Keeps what the listener heard and, when anything is worth answering, queues the writer. */
export const storeHeardMutation = internalMutation({
  args: { personaId: v.id('personas'), posts: v.array(heardPostValidator), mock: v.boolean() },
  handler: async (ctx, args): Promise<HeardOutcome> => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    const outcome = await storeHeard(ctx, persona, { posts: args.posts, now: Date.now(), mock: args.mock })
    if (outcome.kept > 0) await enqueueJob(ctx, { kind: 'write_replies', personaId: persona._id, payload: { personaId: persona._id } })
    return outcome
  },
})

interface WritingContext {
  persona: Doc<'personas'>
  sponsorName: string
  directives: string[]
  memory: WriterMemory
  /** The heard posts to write, oldest first, at most REPLY_WRITES_PER_RUN. */
  heard: Doc<'replies'>[]
}

export const writingContext = internalQuery({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<WritingContext> => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    const workspace = await workspaceOf(ctx, persona)
    const directives = await ctx.db
      .query('directives')
      .withIndex('by_persona_active', (q) => q.eq('personaId', persona._id).eq('active', true))
      .collect()
    const heard = await ctx.db
      .query('replies')
      .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'heard'))
      .take(REPLY_WRITES_PER_RUN)
    return {
      persona,
      sponsorName: workspace.sponsorName,
      directives: directives.map((directive) => directive.text),
      memory: await writerMemory(ctx, persona._id, workspace.sponsorName),
      heard: heard.sort((a, b) => a.heardAt - b.heardAt),
    }
  },
})

/**
 * The writer answers every heard post of the persona, or passes on it. A
 * reply that breaks X's or Influstep's rules is written once more with the
 * problems named; a second miss passes on the post with the reason, so the
 * operator sees it rather than a post that waits forever.
 */
export const writeReplies = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, args): Promise<{ drafts: number; queued: number; skipped: number }> => {
    const personaId = args.personaId as Id<'personas'>
    const context = await ctx.runQuery(internal.internal.replies.writingContext, { personaId })
    const llm = llmProvider()
    const outcome = { drafts: 0, queued: 0, skipped: 0 }
    for (const reply of context.heard) {
      const written = await writeOne(llm, briefFor(context, reply))
      const status = await ctx.runMutation(internal.internal.replies.storeWrittenMutation, { replyId: reply._id, written })
      if (status === 'draft') outcome.drafts += 1
      else if (status === 'queued') outcome.queued += 1
      else if (status === 'skipped') outcome.skipped += 1
    }
    return outcome
  },
})

function briefFor(context: WritingContext, reply: Doc<'replies'>): ReplyBrief {
  const { persona } = context
  return {
    persona: {
      name: persona.name,
      handle: persona.handle,
      niche: persona.niche,
      tone: persona.tone,
      bible: persona.bible,
      pillars: persona.pillars,
    },
    origin: reply.origin,
    post: { text: reply.target.text, author: reply.target.author },
    pillar: reply.pillar ?? null,
    sponsorName: context.sponsorName,
    operatorAsked: reply.operatorAsked,
    memory: context.memory,
    directives: context.directives,
    voice: persona.voice
      ? {
          language: persona.voice.language,
          summary: persona.voice.summary,
          traits: persona.voice.traits,
          emoji: persona.voice.emoji,
          hashtags: persona.voice.hashtags,
        }
      : null,
    partLimit: X_POST_LIMIT,
    problems: [],
  }
}

async function writeOne(llm: LlmProvider, brief: ReplyBrief): Promise<WrittenReply> {
  const problemsOf = (draft: ReplyDraft) =>
    draft.kind === 'skip' ? [] : replyProblems(draft.text, { sponsorName: brief.sponsorName, sponsorAllowed: brief.operatorAsked })
  const first = await llm.writeReply(brief)
  const firstProblems = problemsOf(first)
  if (firstProblems.length === 0) return first
  const second = await llm.writeReply({ ...brief, problems: firstProblems })
  const problems = problemsOf(second)
  if (problems.length === 0) return second
  return { kind: 'skip', reason: `The writer missed the rules twice: ${problems.join(' ')}` }
}

export const storeWrittenMutation = internalMutation({
  args: { replyId: v.id('replies'), written: writtenReplyValidator },
  handler: async (ctx, args) => storeWritten(ctx, args.replyId, args.written, Date.now()),
})

/** Queued replies go out on their own within each persona's budget (crons.ts, every five minutes). */
export const dispatchQueued = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ dispatched: number }> => dispatchQueuedReplies(ctx, args.now ?? Date.now()),
})

export const toMeasure = internalQuery({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<Doc<'replies'>[]> => repliesToMeasure(ctx, args.personaId, Date.now()),
})

export const storeCounts = internalMutation({
  args: { replyId: v.id('replies'), counts: replyCountsValidator },
  handler: async (ctx, args) => storeReplyCounts(ctx, args.replyId, args.counts, Date.now()),
})

/** The analyst reads what each reply sent this week brought back (internal/agents.ts `pullMetrics`). */
export async function measureReplies(ctx: ActionCtx, personaId: Id<'personas'>): Promise<number> {
  const replies = await ctx.runQuery(internal.internal.replies.toMeasure, { personaId })
  for (const reply of replies) {
    if (reply.externalId === undefined || reply.sentAt === undefined) throw new Error(`sent reply ${reply._id} has no X id`)
    const counts = await engagementProvider().counts({ externalId: reply.externalId, sentAt: reply.sentAt })
    await ctx.runMutation(internal.internal.replies.storeCounts, { replyId: reply._id, counts })
  }
  return replies.length
}
