import {
  DRAFT_STALE_MS,
  REPLY_MEASURE_MS,
  REPLY_STATUS_LABELS,
  engagedFirst,
  heardVerdict,
  repliesLeft,
  replyProblems,
  type HeardPost,
  type PublishResult,
  type ReplyCounts,
  type ReplyStatus,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { enqueueJob } from '../jobs/queue'
import { refusal } from '../lib/errors'
import { dayKey, instantAt } from './dates'
import { formatFor, platformsOf } from './formats'
import { workspaceOf } from './workspace'

/**
 * Engagement on X (docs/plan.md, slice 11; shared replies.ts): what the
 * listener keeps, what becomes of a written reply, the daily reply budget, and
 * who sends a reply. A reply to someone who engaged with the persona first
 * goes out on its own when the persona publishes on its own (autoPublish); any
 * other reply waits as a draft until the operator posts it, one click per
 * reply. The budget counts both.
 */

type Reader = { db: QueryCtx['db'] }

/** How many found posts one sweep keeps, the ones with the most reach first, so drafts never pile up past a day's budget. */
export const REPLY_SEARCH_PER_SWEEP = 3

/** How many heard posts one write_replies job writes. */
export const REPLY_WRITES_PER_RUN = 10

/** The persona's daily reply budget: its X cadence's, and none without X. */
export function replyBudget(persona: Doc<'personas'>): number {
  if (!platformsOf(persona).includes('x')) return 0
  const cadence = formatFor(persona, 'x').cadence
  if (!cadence) throw new Error(`persona ${persona._id} has an X format without a cadence`)
  return cadence.repliesPerDay
}

/** Whether the persona listens on X at all: it has X and a reply budget above zero. */
export function listens(persona: Doc<'personas'>): boolean {
  return replyBudget(persona) > 0
}

/** Replies handed to the runner since the persona's local midnight that did not fail: what the budget counts. */
export async function repliesSentToday(ctx: Reader, persona: Doc<'personas'>, now: number): Promise<number> {
  const midnight = instantAt(dayKey(now, persona.timezone), 0, persona.timezone)
  const rows = await ctx.db
    .query('replies')
    .withIndex('by_persona_dispatched', (q) => q.eq('personaId', persona._id).gte('dispatchedAt', midnight))
    .collect()
  return rows.filter((reply) => reply.status === 'sending' || reply.status === 'sent').length
}

/** What the replies page and the persona page read of the budget. */
export async function budgetView(ctx: Reader, persona: Doc<'personas'>, now: number): Promise<{ budget: number; sentToday: number }> {
  return { budget: replyBudget(persona), sentToday: await repliesSentToday(ctx, persona, now) }
}

export interface HeardOutcome {
  kept: number
  skipped: number
  stale: number
}

/**
 * What the listener heard becomes rows: a post worth answering is heard and
 * waits for the writer, a post naming the sponsor is passed on with the
 * reason, everything else is dropped unseen (shared `heardVerdict`). Found
 * posts are kept by reach, at most REPLY_SEARCH_PER_SWEEP a sweep; a mention
 * or a reply under the persona's post is always kept. Drafts nobody posted
 * within a day go stale first.
 */
export async function storeHeard(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  args: { posts: HeardPost[]; now: number; mock: boolean }
): Promise<HeardOutcome> {
  const stale = await skipStale(ctx, persona._id, args.now)
  const workspace = await workspaceOf(ctx, persona)
  const answered = new Set<string>()
  for (const post of args.posts) {
    const row = await ctx.db
      .query('replies')
      .withIndex('by_persona_target', (q) => q.eq('personaId', persona._id).eq('inReplyTo', post.externalId))
      .first()
    if (row) answered.add(post.externalId)
  }
  const context = { personaHandle: persona.handle, sponsorName: workspace.sponsorName, answered, now: args.now }
  const judged = args.posts.map((post) => ({ post, verdict: heardVerdict(post, context) }))
  const found = judged
    .filter(({ post, verdict }) => verdict.kind === 'keep' && post.origin === 'search')
    .sort((a, b) => b.post.author.followers - a.post.author.followers)
    .slice(0, REPLY_SEARCH_PER_SWEEP)
  let kept = 0
  let skipped = 0
  for (const { post, verdict } of judged) {
    if (verdict.kind === 'drop') continue
    if (verdict.kind === 'keep' && post.origin === 'search' && !found.some((candidate) => candidate.post === post)) continue
    await ctx.db.insert('replies', {
      personaId: persona._id,
      origin: post.origin,
      inReplyTo: post.externalId,
      target: { text: post.text, url: post.url, postedAt: post.postedAt, author: post.author },
      pillar: post.pillar ?? undefined,
      status: verdict.kind === 'keep' ? 'heard' : 'skipped',
      text: '',
      skipReason: verdict.kind === 'skip' ? verdict.reason : undefined,
      operatorAsked: false,
      heardAt: args.now,
      mock: args.mock,
    })
    if (verdict.kind === 'keep') kept += 1
    else skipped += 1
  }
  return { kept, skipped, stale }
}

const STALE_REASON = 'Went stale: nobody posted it within a day, and the conversation moved on.'

/** Drafts and queued replies written more than DRAFT_STALE_MS ago are passed on. */
async function skipStale(ctx: MutationCtx, personaId: Id<'personas'>, now: number): Promise<number> {
  let stale = 0
  for (const status of ['draft', 'queued'] as const) {
    const rows = await ctx.db
      .query('replies')
      .withIndex('by_persona_status', (q) => q.eq('personaId', personaId).eq('status', status))
      .collect()
    for (const reply of rows) {
      if (reply.writtenAt === undefined || now - reply.writtenAt <= DRAFT_STALE_MS) continue
      await ctx.db.patch(reply._id, { status: 'skipped', skipReason: STALE_REASON })
      stale += 1
    }
  }
  return stale
}

/** What the writer made of a heard post: the reply, or why the persona passes on it. */
export type WrittenReply = { kind: 'reply'; text: string } | { kind: 'skip'; reason: string }

/**
 * A written reply waits for its sender. One to someone who engaged first is
 * queued to go out on its own when the persona publishes on its own; every
 * other one, and every one the operator asked for, is a draft for the
 * operator. A post the operator passed on meanwhile stays passed on.
 */
export async function storeWritten(ctx: MutationCtx, replyId: Id<'replies'>, written: WrittenReply, now: number): Promise<ReplyStatus> {
  const reply = await ctx.db.get(replyId)
  if (!reply) throw new Error(`reply ${replyId} not found`)
  if (reply.status !== 'heard') return reply.status
  if (written.kind === 'skip') {
    await ctx.db.patch(replyId, { status: 'skipped', skipReason: written.reason, writtenAt: now })
    return 'skipped'
  }
  const persona = await ctx.db.get(reply.personaId)
  if (!persona) throw new Error(`persona ${reply.personaId} not found`)
  const status = engagedFirst(reply.origin) && persona.autoPublish && !reply.operatorAsked ? 'queued' : 'draft'
  await ctx.db.patch(replyId, { status, text: written.text, writtenAt: now })
  return status
}

/** The statuses a reply can be posted from: waiting for the operator, going out on its own, or failed. */
const POSTABLE: readonly ReplyStatus[] = ['draft', 'queued', 'failed']

/**
 * The operator posts one reply, as written or as edited. It goes to the
 * runner now, within the budget; over it, the operator reads why. The
 * operator may name the sponsor: they chose to.
 */
export async function postReplyNow(ctx: MutationCtx, replyId: Id<'replies'>, text: string, now: number): Promise<void> {
  const reply = await ctx.db.get(replyId)
  if (!reply) throw new Error(`reply ${replyId} not found`)
  if (!POSTABLE.includes(reply.status))
    throw refusal(
      `This reply is ${REPLY_STATUS_LABELS[reply.status].toLowerCase()}; only a reply waiting for you, going out or failed can be posted.`
    )
  const persona = await ctx.db.get(reply.personaId)
  if (!persona) throw new Error(`persona ${reply.personaId} not found`)
  if (persona.paused) throw refusal(`${persona.name} is paused; resume it to post replies.`)
  const workspace = await workspaceOf(ctx, persona)
  const problems = replyProblems(text, { sponsorName: workspace.sponsorName, sponsorAllowed: true })
  if (problems.length > 0) throw refusal(problems.join(' '))
  const budget = replyBudget(persona)
  if (budget === 0) throw refusal(`Replies are off for ${persona.name}: the reply budget is 0. Raise it in the persona's settings.`)
  const sent = await repliesSentToday(ctx, persona, now)
  if (repliesLeft(budget, sent) === 0)
    throw refusal(
      `${persona.name} has sent ${sent} of ${budget} ${budget === 1 ? 'reply' : 'replies'} today. Raise the reply budget in the persona's settings, or post this one tomorrow.`
    )
  await handOver(ctx, reply, text.trim(), now)
}

/** The reply goes to the runner: the budget counts it from here. */
async function handOver(ctx: MutationCtx, reply: Doc<'replies'>, text: string, now: number): Promise<void> {
  await ctx.db.patch(reply._id, { status: 'sending', text, dispatchedAt: now, error: undefined })
  await enqueueJob(ctx, {
    kind: 'post_reply',
    personaId: reply.personaId,
    payload: { replyId: reply._id, inReplyTo: reply.inReplyTo, text },
  })
}

/**
 * Queued replies go out on their own (crons.ts, every five minutes): one per
 * persona a run, oldest first, while the day's budget lasts, so replies never
 * arrive in a burst. A paused persona's wait; one written more than a day ago
 * goes stale instead.
 */
export async function dispatchQueuedReplies(ctx: MutationCtx, now: number): Promise<{ dispatched: number }> {
  const queued = await ctx.db
    .query('replies')
    .withIndex('by_status_heard', (q) => q.eq('status', 'queued'))
    .collect()
  const served = new Set<Id<'personas'>>()
  let dispatched = 0
  for (const reply of queued) {
    if (served.has(reply.personaId)) continue
    if (reply.writtenAt !== undefined && now - reply.writtenAt > DRAFT_STALE_MS) {
      await ctx.db.patch(reply._id, { status: 'skipped', skipReason: STALE_REASON })
      continue
    }
    const persona = await ctx.db.get(reply.personaId)
    if (!persona) throw new Error(`persona ${reply.personaId} not found`)
    if (persona.paused) continue
    served.add(persona._id)
    if (repliesLeft(replyBudget(persona), await repliesSentToday(ctx, persona, now)) === 0) continue
    await handOver(ctx, reply, reply.text, now)
    dispatched += 1
  }
  return { dispatched }
}

/** X took the reply. One that is no longer sending was never handed over by this job, so that is a bug. */
export async function completeReply(ctx: MutationCtx, replyId: Id<'replies'>, result: PublishResult): Promise<void> {
  const reply = await ctx.db.get(replyId)
  if (!reply) throw new Error(`reply ${replyId} not found`)
  if (reply.status !== 'sending') throw new Error(`reply ${replyId} is ${reply.status}, not sending`)
  await ctx.db.patch(replyId, {
    status: 'sent',
    sentAt: result.publishedAt,
    externalId: result.externalId,
    url: result.url,
    mock: result.mock,
  })
}

/** X or the runner refused the reply; it no longer counts against the budget, and the operator can post it again. */
export async function failReply(ctx: MutationCtx, replyId: Id<'replies'>, error: string): Promise<void> {
  const reply = await ctx.db.get(replyId)
  if (!reply) throw new Error(`reply ${replyId} not found`)
  await ctx.db.patch(replyId, { status: 'failed', error })
}

/** The operator passes on a reply that has not gone out. */
export async function skipReply(ctx: MutationCtx, replyId: Id<'replies'>): Promise<void> {
  const reply = await ctx.db.get(replyId)
  if (!reply) throw new Error(`reply ${replyId} not found`)
  if (!POSTABLE.includes(reply.status))
    throw refusal(`This reply is ${REPLY_STATUS_LABELS[reply.status].toLowerCase()}; only one that has not gone out can be skipped.`)
  await ctx.db.patch(replyId, { status: 'skipped', skipReason: 'You passed on it.' })
}

/**
 * The operator asks for a reply to a post the persona passed on: the writer
 * writes one whatever the rules say, it may answer about the sponsor, and it
 * waits as a draft for the operator to post.
 */
export async function askForReply(ctx: MutationCtx, replyId: Id<'replies'>): Promise<void> {
  const reply = await ctx.db.get(replyId)
  if (!reply) throw new Error(`reply ${replyId} not found`)
  if (reply.status !== 'skipped') throw refusal('Only a post the persona passed on can be asked for again.')
  await ctx.db.patch(replyId, { status: 'heard', operatorAsked: true, skipReason: undefined, text: '' })
  await enqueueJob(ctx, { kind: 'write_replies', personaId: reply.personaId, payload: { personaId: reply.personaId } })
}

/** The persona's sent replies the analyst still reads: sent within REPLY_MEASURE_MS. */
export async function repliesToMeasure(ctx: Reader, personaId: Id<'personas'>, now: number): Promise<Doc<'replies'>[]> {
  const sent = await ctx.db
    .query('replies')
    .withIndex('by_persona_status', (q) => q.eq('personaId', personaId).eq('status', 'sent'))
    .collect()
  return sent.filter((reply) => reply.sentAt !== undefined && reply.externalId !== undefined && now - reply.sentAt <= REPLY_MEASURE_MS)
}

export async function storeReplyCounts(ctx: MutationCtx, replyId: Id<'replies'>, counts: ReplyCounts, now: number): Promise<void> {
  await ctx.db.patch(replyId, { counts, measuredAt: now })
}

/** How many replies the report names as the ones that brought followers. */
const BEST_REPLIES = 3

/**
 * The report's engagement block: the replies sent in the window, what the
 * measured ones brought back, follows per measured reply, and the replies
 * that brought the most followers. Null for a persona without X.
 */
export async function engagementReport(ctx: Reader, persona: Doc<'personas'>, since: number) {
  if (!platformsOf(persona).includes('x')) return null
  const sent = (
    await ctx.db
      .query('replies')
      .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'sent'))
      .collect()
  ).filter((reply) => reply.sentAt !== undefined && reply.sentAt >= since)
  // A reply the analyst has not read yet brought back nothing known, so the numbers are over the measured ones.
  const measured = sent.flatMap((reply) => (reply.counts === undefined ? [] : [{ reply, counts: reply.counts }]))
  const sum = (key: keyof ReplyCounts) => measured.reduce((total, row) => total + row.counts[key], 0)
  const follows = sum('follows')
  const best = measured
    .filter((row) => row.counts.follows > 0)
    .sort((a, b) => b.counts.follows - a.counts.follows)
    .slice(0, BEST_REPLIES)
    .map(({ reply, counts }) => ({
      _id: reply._id,
      text: reply.text,
      url: reply.url ?? null,
      author: reply.target.author.handle,
      post: reply.target.text,
      follows: counts.follows,
      likes: counts.likes,
    }))
  return {
    sent: sent.length,
    measured: measured.length,
    impressions: sum('impressions'),
    likes: sum('likes'),
    profileVisits: sum('profileVisits'),
    follows,
    followsPerReply: measured.length === 0 ? 0 : follows / measured.length,
    best,
    mock: sent.some((reply) => reply.mock),
  }
}

/** How many replies of one status the persona holds. */
async function countOf(ctx: Reader, personaId: Id<'personas'>, status: ReplyStatus): Promise<number> {
  const rows = await ctx.db
    .query('replies')
    .withIndex('by_persona_status', (q) => q.eq('personaId', personaId).eq('status', status))
    .collect()
  return rows.length
}

/** What the persona page says of the replies: the budget, today's count, and what waits. Null for a persona without X. */
export async function replySummary(ctx: Reader, persona: Doc<'personas'>, now: number) {
  if (!platformsOf(persona).includes('x')) return null
  return {
    ...(await budgetView(ctx, persona, now)),
    waiting: await countOf(ctx, persona._id, 'draft'),
    goingOut: (await countOf(ctx, persona._id, 'queued')) + (await countOf(ctx, persona._id, 'sending')),
  }
}

/** How many rows of the sent and skipped lists the replies page shows, newest first. */
const HISTORY_ROWS = 30

/**
 * The replies page: what waits for the operator, what goes out on its own or
 * is being written or sent, what went out with what it brought back, what
 * failed, and what the persona passed on and why.
 */
export async function repliesView(ctx: Reader, persona: Doc<'personas'>, now: number) {
  const of = (status: ReplyStatus) =>
    ctx.db
      .query('replies')
      .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', status))
      .collect()
  const newest = (rows: Doc<'replies'>[], at: (reply: Doc<'replies'>) => number) => rows.sort((a, b) => at(b) - at(a))
  return {
    ...(await budgetView(ctx, persona, now)),
    waiting: newest(await of('draft'), (reply) => reply.target.author.followers),
    goingOut: [...(await of('sending')), ...(await of('queued')), ...(await of('heard'))],
    failed: await of('failed'),
    sent: newest(await of('sent'), (reply) => reply.sentAt ?? reply.heardAt).slice(0, HISTORY_ROWS),
    skipped: newest(await of('skipped'), (reply) => reply.writtenAt ?? reply.heardAt).slice(0, HISTORY_ROWS),
  }
}
