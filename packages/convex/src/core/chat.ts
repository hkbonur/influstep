import { ConvexError } from 'convex/values'
import {
  AGENT_ROLE_LABELS,
  JOB_KINDS,
  JOB_KIND_LABELS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  carriesCode,
  isChatTask,
  matchEpisodes,
  normalizeDiscountCode,
  scriptDayOf,
  shortDayLabel,
  weekdayOf,
  type ChatIntent,
  type EpisodeStatus,
  type EpisodeTarget,
  type PostIntent,
  type PostKind,
  type PostLength,
  type Weekday,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { enqueueJob } from '../jobs/queue'
import { addDays, dayKey, hourAt, weekStart } from './dates'
import { INVALID_CODE, codeGivenText, giveDiscountCode } from './discounts'
import { createIdea, killEpisode, rescheduleEpisode, scriptBeingWritten } from './episodes'
import { rememberFromOperator } from './memory'

/**
 * The persona's chat as a way to change things (docs/plan.md, slice 7). An
 * operator message is read once into an intent (shared `ChatIntent`); the
 * rules here apply it and store what the persona says back. Nothing here
 * throws a refusal at the operator: a change that cannot apply is a reply
 * that says why, and nothing changes.
 */

type Reader = { db: QueryCtx['db'] }

/** What a chat change may touch: nothing recording, nothing measured or killed, nothing gone out. */
const CHANGEABLE_STATUSES: readonly EpisodeStatus[] = ['idea', 'scripted', 'waiting_on_you', 'failed', 'rendered', 'scheduled']

/** How many planned episodes a reply lists when the message named none of them. */
const PLAN_LINES = 5

/**
 * The episodes a chat message may change: the persona's own from today
 * (in its timezone) through the end of next week, at a changeable status,
 * none of whose publications is uploading or live. A scheduled episode is
 * the one that can have one; a failed episode can too, when one platform went
 * out before another failed, and it is left alone for the same reason. Sorted
 * by publish time. This list is what the interpreter sees and the only thing
 * a chat change can touch.
 */
export async function changeablePlan(ctx: Reader, personaId: Id<'personas'>): Promise<Doc<'episodes'>[]> {
  const persona = await ctx.db.get(personaId)
  if (!persona) throw new Error(`persona ${personaId} not found`)
  const today = dayKey(Date.now(), persona.timezone)
  const lastDay = addDays(weekStart(today), 13)
  const episodes = await ctx.db
    .query('episodes')
    .withIndex('by_persona_day', (q) => q.eq('personaId', personaId).gte('plannedFor', today).lte('plannedFor', lastDay))
    .collect()
  const plan: Doc<'episodes'>[] = []
  for (const episode of episodes) {
    if (!CHANGEABLE_STATUSES.includes(episode.status)) continue
    if (await hasGoneOut(ctx, episode._id)) continue
    plan.push(episode)
  }
  return plan.sort((a, b) => a.scheduledAt - b.scheduledAt)
}

async function hasGoneOut(ctx: Reader, episodeId: Id<'episodes'>): Promise<boolean> {
  const publications = await ctx.db
    .query('publications')
    .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
    .collect()
  return publications.some((publication) => publication.status === 'uploading' || publication.status === 'live')
}

/** What a chat message did: the persona's reply, the episode it touched or created, the job it queued. */
export interface ChatOutcome {
  text: string
  episodeId?: Id<'episodes'>
  jobId?: Id<'jobs'>
}

/**
 * Applies an operator message's intent and stores the persona's reply, linked
 * to the episode and the job when there is one; returns what it stored. A
 * directive or a conversation is answered with `reply`, the provider's reply
 * written in the action before this mutation; every other kind is answered
 * here and takes null. A code that goes through is confirmed by the code rule
 * itself (core/discounts.ts), so no second message is stored for it.
 */
export async function applyChatIntent(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  messageId: Id<'messages'>,
  intent: ChatIntent,
  reply: string | null
): Promise<ChatOutcome> {
  switch (intent.kind) {
    case 'conversation':
      return storeReply(ctx, persona, { text: providerReply(reply, intent.kind) })
    case 'directive':
      return applyDirective(ctx, persona, messageId, intent.text, providerReply(reply, intent.kind))
    case 'replace':
      return storeReply(ctx, persona, await replaceEpisode(ctx, persona, intent.target, intent.concept))
    case 'move':
      return storeReply(ctx, persona, await moveEpisode(ctx, persona, intent.target, intent.to))
    case 'drop':
      return storeReply(ctx, persona, await dropEpisode(ctx, persona, intent.target))
    case 'task':
      return storeReply(ctx, persona, await askForTask(ctx, persona, messageId, intent))
    case 'give_code':
      return giveCode(ctx, persona, intent)
    case 'remember':
      return storeReply(ctx, persona, await remember(ctx, persona, messageId, intent))
  }
}

/**
 * A fact or a rule the operator asked the persona to remember goes into its
 * memory with the message as its evidence, and the reply says it in the
 * persona's words. Words already remembered are not stored twice.
 */
async function remember(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  messageId: Id<'messages'>,
  intent: Extract<ChatIntent, { kind: 'remember' }>
): Promise<ChatOutcome> {
  const outcome = await rememberFromOperator(ctx, persona, { kind: intent.memory, text: intent.text, messageId, now: Date.now() })
  switch (outcome.status) {
    case 'invalid':
      return { text: `I could not keep that. ${outcome.problem}` }
    case 'known':
      return { text: `I already remember that: "${outcome.text}"` }
    case 'stored':
      return {
        text:
          intent.memory === 'rule'
            ? `I will keep this rule: "${outcome.text}" I read my rules before every script and post.`
            : `I will remember that: "${outcome.text}" I read what I know before every script and post.`,
      }
  }
}

function providerReply(reply: string | null, kind: ChatIntent['kind']): string {
  if (reply === null) throw new Error(`a ${kind} message is answered with the provider's reply, and none was given`)
  return reply
}

async function storeReply(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  outcome: ChatOutcome,
  directiveId?: Id<'directives'>
): Promise<ChatOutcome> {
  await ctx.db.insert('messages', {
    personaId: persona._id,
    author: 'persona',
    text: outcome.text,
    directiveId,
    episodeId: outcome.episodeId,
    jobId: outcome.jobId,
    createdAt: Date.now(),
  })
  return outcome
}

type Attempt<T> = { ok: true; value: T } | { ok: false; refusal: string }

/**
 * Runs a rule and hands back its refusal as the text of the reply instead of
 * throwing it. Every rule called this way refuses before its first write, so
 * a refusal leaves nothing changed. A bug still throws.
 */
async function attempt<T>(rule: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await rule() }
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === 'string') return { ok: false, refusal: error.data }
    throw error
  }
}

/** "Tue 13 Oct: Retry a failed webhook". */
function planLine(episode: Doc<'episodes'>): string {
  return `${shortDayLabel(episode.plannedFor)}: ${episode.title}`
}

function weekdayLabel(day: string): string {
  return WEEKDAY_LABELS[weekdayOf(day)]
}

type Resolved = { ok: true; episode: Doc<'episodes'> } | { ok: false; text: string }

/**
 * The one episode of the changeable plan a target names, among those that
 * `fits` (all by default), or the reply that says there is none or that there
 * are several.
 */
async function resolveTarget(
  ctx: Reader,
  persona: Doc<'personas'>,
  target: EpisodeTarget,
  fits: (episode: Doc<'episodes'>) => boolean = () => true
): Promise<Resolved> {
  const plan = (await changeablePlan(ctx, persona._id)).filter(fits)
  const matches = matchEpisodes(plan, target)
  const [only] = matches
  if (only && matches.length === 1) return { ok: true, episode: only }
  if (matches.length > 1)
    return { ok: false, text: `That matches ${matches.length} episodes: ${matches.map(planLine).join('; ')}. Which one?` }
  const notFound = 'I could not find an episode of mine that matches.'
  if (plan.length === 0) return { ok: false, text: `${notFound} Nothing of mine can change between today and the end of next week.` }
  return { ok: false, text: `${notFound} Planned:\n${plan.slice(0, PLAN_LINES).map(planLine).join('\n')}` }
}

/** Whether a target names an episode at all; a code with a target that names none is for the persona. */
function namesEpisode(target: EpisodeTarget): boolean {
  if (target.episodeId !== undefined) return true
  if (target.next === true) return true
  if (target.weekday !== undefined) return true
  return (target.keyword ?? '').trim() !== ''
}

/** The kind of the new episode and, for a post, the slot, intent and length of the one it replaces. */
type ReplacementShape =
  | { kind: 'video'; platforms: Doc<'episodes'>['platforms'] }
  | { kind: PostKind; publishHour: number; intent: PostIntent; length: PostLength }

/** Null for a post planned before posts had an intent and a length: its replacement has none to keep. */
function replacementShape(episode: Doc<'episodes'>, persona: Doc<'personas'>): ReplacementShape | null {
  if (episode.kind === 'video') return { kind: 'video', platforms: episode.platforms }
  if (episode.intent === undefined || episode.length === undefined) return null
  return { kind: episode.kind, publishHour: hourAt(episode.scheduledAt, persona.timezone), intent: episode.intent, length: episode.length }
}

/**
 * The target is killed and a new idea takes its day: the same kind, sponsor
 * segment, platforms and post shape, the pillar kept, with the concept the
 * operator asked for. The experiment and variant are dropped, since a
 * replacement no longer tests what the old episode was assigned, and no
 * signal feeds it. The writer gets it as any idea, the day before it goes
 * out (core `queueScriptIfDue`), and the reply says when.
 *
 * The new idea is created first: it can refuse (a platform the persona has
 * since removed), and a refusal then leaves the old episode as it was. The
 * kill cannot refuse an episode of the changeable plan, which holds only
 * statuses that can be killed and nothing uploading, so a refusal there is a
 * bug and throws.
 */
async function replaceEpisode(ctx: MutationCtx, persona: Doc<'personas'>, target: EpisodeTarget, concept: string): Promise<ChatOutcome> {
  const resolved = await resolveTarget(ctx, persona, target)
  if (!resolved.ok) return { text: resolved.text }
  const old = resolved.episode
  const newConcept = concept.trim()
  if (newConcept === '') return { text: `What should replace "${old.title}"? Say what the new episode is about.`, episodeId: old._id }
  const shape = replacementShape(old, persona)
  if (!shape) {
    return {
      text: `I cannot replace "${old.title}": it was planned before posts had an intent and a length. Drop it instead.`,
      episodeId: old._id,
    }
  }
  const created = await attempt(() =>
    createIdea(ctx, persona, {
      ...shape,
      personaId: persona._id,
      plannedFor: old.plannedFor,
      concept: newConcept,
      pillar: old.pillar,
      sponsorSegment: old.sponsorSegment,
      signalIds: [],
    })
  )
  if (!created.ok) return { text: created.refusal, episodeId: old._id }
  const episodeId = created.value
  await killEpisode(ctx, old._id)
  const when = (await scriptBeingWritten(ctx, episodeId))
    ? 'The writer is on it.'
    : `The writer writes it on ${shortDayLabel(scriptDayOf(old.plannedFor))}.`
  return { text: `Replaced ${weekdayLabel(old.plannedFor)}'s "${old.title}" with "${newConcept}". ${when}`, episodeId }
}

/** To the named weekday of the episode's own week (Monday first, in the persona's timezone), never to a day that has passed. */
async function moveEpisode(ctx: MutationCtx, persona: Doc<'personas'>, target: EpisodeTarget, to: Weekday): Promise<ChatOutcome> {
  const resolved = await resolveTarget(ctx, persona, target)
  if (!resolved.ok) return { text: resolved.text }
  const episode = resolved.episode
  const from = weekdayLabel(episode.plannedFor)
  const plannedFor = addDays(weekStart(episode.plannedFor), WEEKDAYS.indexOf(to))
  if (plannedFor === episode.plannedFor) return { text: `"${episode.title}" is already on ${from}.`, episodeId: episode._id }
  if (plannedFor < dayKey(Date.now(), persona.timezone)) {
    return { text: `${shortDayLabel(plannedFor)} has passed, so "${episode.title}" stays on ${from}.`, episodeId: episode._id }
  }
  const moved = await attempt(() => rescheduleEpisode(ctx, episode._id, plannedFor))
  if (!moved.ok) return { text: moved.refusal, episodeId: episode._id }
  return { text: `Moved "${episode.title}" from ${from} to ${WEEKDAY_LABELS[to]}.`, episodeId: episode._id }
}

async function dropEpisode(ctx: MutationCtx, persona: Doc<'personas'>, target: EpisodeTarget): Promise<ChatOutcome> {
  const resolved = await resolveTarget(ctx, persona, target)
  if (!resolved.ok) return { text: resolved.text }
  const episode = resolved.episode
  const killed = await attempt(() => killEpisode(ctx, episode._id))
  if (!killed.ok) return { text: killed.refusal, episodeId: episode._id }
  return {
    text: `Dropped "${episode.title}" (${weekdayLabel(episode.plannedFor)}). It stays in the calendar as killed.`,
    episodeId: episode._id,
  }
}

/**
 * A directive is stored as it is today: the operator's message carries its
 * id, so the chat marks it and Withdraw reaches it, and the persona's reply
 * carries it too. The interpreter may restate the directive; the words it
 * stores are the interpreter's, or the operator's own message when the
 * interpreter gave none.
 */
async function applyDirective(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  messageId: Id<'messages'>,
  restated: string,
  reply: string
): Promise<ChatOutcome> {
  const message = await ctx.db.get(messageId)
  if (!message) throw new Error(`message ${messageId} not found`)
  if (message.personaId !== persona._id) throw new Error(`message ${messageId} belongs to another persona`)
  const text = restated.trim() === '' ? message.text : restated.trim()
  const directiveId = await ctx.db.insert('directives', { personaId: persona._id, text, active: true, createdAt: Date.now() })
  await ctx.db.patch(messageId, { directiveId })
  return storeReply(ctx, persona, { text: reply }, directiveId)
}

/** "a research brief", "an analytics summary". */
function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
}

/** The task goes to the queue of the role that owns its data; its answer comes back as a message of its own. */
async function askForTask(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  messageId: Id<'messages'>,
  intent: Extract<ChatIntent, { kind: 'task' }>
): Promise<ChatOutcome> {
  const topic = (intent.topic ?? '').trim()
  const payload = topic === '' ? { personaId: persona._id, messageId } : { personaId: persona._id, topic, messageId }
  const jobId = await enqueueJob(ctx, { kind: intent.task, payload, personaId: persona._id, messageId })
  const role = AGENT_ROLE_LABELS[JOB_KINDS[intent.task].role].toLowerCase()
  const task = withArticle(JOB_KIND_LABELS[intent.task].toLowerCase())
  const on = topic === '' ? '' : ` on ${topic}`
  return { text: `Asked the ${role} for ${task}${on}. It lands here when it is done.`, jobId }
}

/**
 * A code the operator hands over in chat. Without an offer the persona asks
 * what it gives, since every description says it; with one, the code rule
 * applies it, persona-wide or to the one episode named, and posts its own
 * confirmation. A refusal of that rule (a code that is not one, a code in use
 * elsewhere, an episode past changing its descriptions) is the reply.
 */
async function giveCode(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  intent: Extract<ChatIntent, { kind: 'give_code' }>
): Promise<ChatOutcome> {
  const code = normalizeDiscountCode(intent.code)
  if (!code) return storeReply(ctx, persona, { text: INVALID_CODE })
  const offer = (intent.offer ?? '').trim()
  if (offer === '') {
    return storeReply(ctx, persona, { text: `What does ${code} give? Say for example: use code ${code}, 20% off Pro for 3 months.` })
  }
  let episode: Doc<'episodes'> | null = null
  if (intent.target && namesEpisode(intent.target)) {
    // Only an episode a code reaches can take one, so "Wednesday's episode" skips Wednesday's X posts.
    const resolved = await resolveTarget(ctx, persona, intent.target, carriesCode)
    if (!resolved.ok) return storeReply(ctx, persona, { text: resolved.text })
    episode = resolved.episode
  }
  const episodeId = episode?._id
  const given = await attempt(() => giveDiscountCode(ctx, { personaId: persona._id, code, offer, episodeId }))
  if (!given.ok) return storeReply(ctx, persona, { text: given.refusal, episodeId })
  return { text: codeGivenText({ code, offer, episodeTitle: episode?.title ?? null }), episodeId }
}

/**
 * A chat task that failed still answers in the chat, linked to its job, so
 * the operator who asked is never left waiting. Dispatch calls this when the
 * task's action throws; the action itself posts nothing on failure.
 */
export async function reportChatTaskFailure(ctx: MutationCtx, job: Doc<'jobs'>, error: string): Promise<void> {
  if (!isChatTask(job.kind)) throw new Error(`job ${job._id} is ${job.kind}, not a chat task`)
  if (job.personaId === undefined) throw new Error(`chat task ${job._id} has no persona`)
  const role = AGENT_ROLE_LABELS[job.role].toLowerCase()
  await ctx.db.insert('messages', {
    personaId: job.personaId,
    author: 'persona',
    text: `The ${role} could not finish the ${JOB_KIND_LABELS[job.kind].toLowerCase()}: ${error}`,
    jobId: job._id,
    createdAt: Date.now(),
  })
}
