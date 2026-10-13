import {
  BRIEF_TTL_MS,
  PROBLEM_REPEAT_MIN,
  PROBLEM_SCORE,
  PROBLEM_WINDOW_DAYS,
  SIGNAL_SOURCES,
  SIGNAL_SOURCE_LABELS,
  SWAP_MIN_FRESHNESS,
  groupQuestions,
  isCold,
  shortDayLabel,
  signalFreshness,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { providersMode } from '../lib/env'
import { PRESENTER_TOOL } from '../providers/llm'
import { activeEntries } from './memory'
import { signalConcept } from './planner'
import { workspaceOf } from './workspace'

/**
 * The researcher's rules (docs/plan.md, v0.2 item 9): the daily brief it
 * writes to memory after the morning sweep, the problem log (a question
 * repeated under the persona's videos, a tool that broke in a recording),
 * and the last check before a script is written, which swaps a reactive
 * concept whose signal went cold. All deterministic; the writer reads the
 * brief and the problems (internal/data.ts `getEpisodeContext`).
 */

type Reader = { db: QueryCtx['db'] }

const DAY_MS = 86_400_000

/** How many of the freshest signals a brief names, and how many open problems the writer reads. */
const BRIEF_TOP = 5
const WRITER_PROBLEMS = 5

/** The longest error line a recording problem quotes. */
const ERROR_LINE_MAX = 140

/** When a signal was posted: its source's own time, or when the researcher found it when the source gives none. */
function postedAt(signal: Pick<Doc<'signals'>, 'publishedAt' | 'foundAt'>): number {
  if (signal.publishedAt === undefined) return signal.foundAt
  return signal.publishedAt
}

/** The persona's signals the operator did not dismiss, of every source. */
async function liveSignals(ctx: Reader, personaId: Id<'personas'>): Promise<Doc<'signals'>[]> {
  const signals = await ctx.db
    .query('signals')
    .withIndex('by_persona_status', (q) => q.eq('personaId', personaId))
    .collect()
  return signals.filter((signal) => signal.status !== 'dismissed')
}

/** The persona's open problems, newest first. A problem stays open until the operator marks it resolved (core/memory.ts). */
export async function activeProblems(ctx: Reader, personaId: Id<'personas'>): Promise<Doc<'memories'>[]> {
  return activeEntries(ctx, personaId, 'problem')
}

/**
 * The brief the writer reads now: the persona's active brief while it has not
 * expired, else null. An expired brief is never read: a missed sweep must not
 * hand the writer yesterday's news as today's.
 */
export async function activeBrief(ctx: Reader, personaId: Id<'personas'>, now: number): Promise<Doc<'memories'> | null> {
  for (const brief of await activeEntries(ctx, personaId, 'brief')) {
    if (brief.expiresAt === undefined) throw new Error(`brief ${brief._id} has no expiry`)
    if (brief.expiresAt > now) return brief
  }
  return null
}

/**
 * The persona's newest brief, expired or not, for the persona page, which
 * judges the expiry against its own clock since a query does not run again
 * when a brief runs out. The writer reads `activeBrief` instead.
 */
export async function latestBrief(ctx: Reader, personaId: Id<'personas'>): Promise<(Doc<'memories'> & { expiresAt: number }) | null> {
  const [brief] = await activeEntries(ctx, personaId, 'brief')
  if (brief === undefined) return null
  const expiresAt = brief.expiresAt
  if (expiresAt === undefined) throw new Error(`brief ${brief._id} has no expiry`)
  return { ...brief, expiresAt }
}

/** What the writer reads of the research: the brief in force and the open problems, newest first. */
export async function researchFor(
  ctx: Reader,
  personaId: Id<'personas'>,
  now: number
): Promise<{ brief: string | null; problems: string[] }> {
  const brief = await activeBrief(ctx, personaId, now)
  const problems = await activeProblems(ctx, personaId)
  return { brief: brief === null ? null : brief.text, problems: problems.slice(0, WRITER_PROBLEMS).map((problem) => problem.text) }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The morning brief: what the persona's sources found or found again in the
 * last 24 hours, one line per source with its count, the five freshest by
 * name, and the open problems in one line. With nothing new it still says
 * so, so the writer knows the sweep ran. The brief before it is superseded,
 * never deleted, and the new one expires after BRIEF_TTL_MS.
 */
export async function writeDailyBrief(ctx: MutationCtx, persona: Pick<Doc<'personas'>, '_id'>, now: number): Promise<Id<'memories'>> {
  const since = now - DAY_MS
  const recent = (await liveSignals(ctx, persona._id)).filter((signal) => {
    if (signal.foundAt >= since) return true
    return signal.publishedAt !== undefined && signal.publishedAt >= since
  })
  const ranked = recent
    .map((signal) => ({ signal, freshness: signalFreshness(signal, now) }))
    .sort((a, b) => b.freshness - a.freshness || b.signal.score - a.signal.score)
  const top = ranked.slice(0, BRIEF_TOP)
  const problems = await activeProblems(ctx, persona._id)

  const lines: string[] = []
  if (ranked.length === 0) {
    lines.push('Nothing new moved since yesterday.')
  } else {
    for (const source of SIGNAL_SOURCES) {
      const count = recent.filter((signal) => signal.source === source).length
      if (count === 0) continue
      lines.push(`${SIGNAL_SOURCE_LABELS[source]}: ${plural(count, 'new item', 'new items')}.`)
    }
    lines.push('The strongest:')
    for (const entry of top) {
      lines.push(`"${entry.signal.title}" (${SIGNAL_SOURCE_LABELS[entry.signal.source]}, freshness ${entry.freshness})`)
    }
  }
  if (problems.length > 0) lines.push(`Open problems: ${problems.map((problem) => problem.text).join(' ')}`)

  const briefId = await ctx.db.insert('memories', {
    personaId: persona._id,
    kind: 'brief',
    text: lines.join('\n'),
    actor: 'researcher',
    evidence: { episodeIds: [], signalIds: top.map((entry) => entry.signal._id) },
    expiresAt: now + BRIEF_TTL_MS,
    status: 'active',
    createdAt: now,
  })
  const earlier = await ctx.db
    .query('memories')
    .withIndex('by_persona_kind_status', (q) => q.eq('personaId', persona._id).eq('kind', 'brief').eq('status', 'active'))
    .collect()
  for (const brief of earlier) {
    if (brief._id === briefId) continue
    await ctx.db.patch(brief._id, { status: 'superseded', supersededBy: briefId })
  }
  return briefId
}

/**
 * A problem as a concept candidate: a signal from the problem log, scored
 * PROBLEM_SCORE, that the planner, the last check and the Signals page rank
 * like any other. Its external id is the problem's memory id, and it links
 * nowhere.
 */
async function insertCandidate(
  ctx: MutationCtx,
  args: { personaId: Id<'personas'>; problemId: Id<'memories'>; title: string; summary: string; topics: string[]; now: number }
): Promise<Id<'signals'>> {
  return ctx.db.insert('signals', {
    personaId: args.personaId,
    source: 'problems',
    externalId: args.problemId,
    title: args.title,
    url: '',
    summary: args.summary,
    score: PROBLEM_SCORE,
    topics: args.topics,
    status: 'new',
    foundAt: args.now,
    publishedAt: args.now,
    mock: providersMode() === 'mock',
  })
}

function union<T>(a: readonly T[], b: readonly T[]): T[] {
  return [...new Set([...a, ...b])]
}

/**
 * The question side of the problem log: the comment signals of the last
 * PROBLEM_WINDOW_DAYS that ask something, grouped by what they ask (shared
 * `groupQuestions`, oldest first so a group reads as first asked). A comment
 * a resolved problem rests on is left out, so resolving a problem holds until
 * the question is asked again PROBLEM_REPEAT_MIN times. A group of
 * PROBLEM_REPEAT_MIN or more is a problem: one already open under the same
 * key, or holding one of the group's comments, takes the new comments into
 * its evidence, else a new problem and its candidate signal are written.
 * Comment signals record no episode (the publisher's comment poll stores the
 * publication's url, not its episode), so the evidence names no episodes.
 * Returns the problems it wrote.
 */
export async function logRepeatedQuestions(
  ctx: MutationCtx,
  persona: Pick<Doc<'personas'>, '_id'>,
  now: number
): Promise<Id<'memories'>[]> {
  const since = now - PROBLEM_WINDOW_DAYS * DAY_MS
  // A comment a resolved problem rests on was answered once; it does not count toward the same problem again.
  const resolved = await ctx.db
    .query('memories')
    .withIndex('by_persona_kind_status', (q) => q.eq('personaId', persona._id).eq('kind', 'problem').eq('status', 'retired'))
    .collect()
  const answered = new Set(resolved.flatMap((problem) => problem.evidence.signalIds))
  const questions = (await liveSignals(ctx, persona._id))
    .filter((signal) => {
      if (signal.source !== 'comments' || postedAt(signal) < since || answered.has(signal._id)) return false
      // Only the comment's own words say whether it asks something. The slice brief reads "title or summary", but a
      // comment signal's summary is the line the comment poll writes ('<n> likes under "<publication title>"'),
      // so a "?" in the video's title would count every comment under it as a question, "Great video!" too.
      return signal.title.includes('?')
    })
    .sort((a, b) => postedAt(a) - postedAt(b))
  const groups = groupQuestions(questions.map((signal) => ({ id: signal._id, text: signal.title })))
  const open = await activeProblems(ctx, persona._id)
  const written: Id<'memories'>[] = []
  for (const group of groups) {
    if (group.ids.length < PROBLEM_REPEAT_MIN) continue
    const signalIds = group.ids.flatMap((id) => {
      const signal = questions.find((candidate) => candidate._id === id)
      if (!signal) throw new Error(`question ${id} came back from grouping but was never asked`)
      return [signal._id]
    })
    // A question with no meaningful word groups with nothing (shared `groupQuestions`), so a group this size
    // always names some: an empty key would merge unrelated questions into one problem.
    if (group.tokens.length === 0) throw new Error(`a group of ${group.ids.length} questions names no word to key it by`)
    const key = `question:${group.tokens.join(' ')}`
    // A new comment that joins a group can narrow the tokens every member shares, and so its key: the problem
    // that already holds one of the group's comments is the same question, not a new one.
    const known = open.find((problem) => {
      if (problem.key === key) return true
      if (problem.key === undefined || !problem.key.startsWith('question:')) return false
      return problem.evidence.signalIds.some((id) => signalIds.includes(id))
    })
    if (known) {
      await ctx.db.patch(known._id, { evidence: { ...known.evidence, signalIds: union(known.evidence.signalIds, signalIds) } })
      continue
    }
    const text = `Viewers keep asking: "${group.text}" (${group.ids.length} times under my videos).`
    const problemId = await ctx.db.insert('memories', {
      personaId: persona._id,
      kind: 'problem',
      text,
      actor: 'researcher',
      evidence: { episodeIds: [], signalIds },
      key,
      status: 'active',
      createdAt: now,
    })
    await insertCandidate(ctx, { personaId: persona._id, problemId, title: group.text, summary: text, topics: group.tokens, now })
    written.push(problemId)
  }
  return written
}

/** The first line of an error, at most ERROR_LINE_MAX characters, without a closing period (the problem adds its own). */
function errorLine(error: string): string {
  const [first] = error.trim().split('\n')
  if (first === undefined) return ''
  return first.trim().slice(0, ERROR_LINE_MAX).replace(/\.$/, '')
}

/**
 * The recording side of the problem log: a screen shot that broke while the
 * producer recorded a tool. The tool is the beat's (`shot-<n>` is beat n).
 * Nothing is logged for the presenter, for the sponsor (never a video about
 * the sponsor breaking), or for a shot that records no screen; a sign-in the
 * tool needs is a checklist item before production, never a problem. A tool
 * that broke before takes the episode into its evidence. Null when nothing
 * was logged.
 */
export async function logRecordingProblem(
  ctx: MutationCtx,
  args: { episodeId: Id<'episodes'>; shotId: string; error: string; now: number }
): Promise<Id<'memories'> | null> {
  const episode = await ctx.db.get(args.episodeId)
  if (!episode) throw new Error(`episode ${args.episodeId} not found`)
  const persona = await ctx.db.get(episode.personaId)
  if (!persona) throw new Error(`persona ${episode.personaId} not found`)
  // The failure lands whatever the runner named: a shot the episode does not have, or one that records no
  // screen, names no tool, so there is no problem to log.
  const shot = episode.shots.find((candidate) => candidate.id === args.shotId)
  if (!shot || shot.kind !== 'screen') return null
  const match = /^shot-(\d+)$/.exec(args.shotId)
  if (!match) throw new Error(`screen shot ${args.shotId} of episode ${episode._id} is not named shot-<n>`)
  const beat = episode.shotPlan?.[Number(match[1]) - 1]
  if (!beat) throw new Error(`screen shot ${args.shotId} of episode ${episode._id} has no beat`)
  const tool = beat.tool.trim()
  if (tool === PRESENTER_TOOL) return null
  const workspace = await workspaceOf(ctx, persona)
  if (tool.toLowerCase() === workspace.sponsorName.trim().toLowerCase()) return null

  const key = `tool:${tool.toLowerCase()}`
  const known = (await activeProblems(ctx, persona._id)).find((problem) => problem.key === key)
  if (known) {
    await ctx.db.patch(known._id, { evidence: { ...known.evidence, episodeIds: union(known.evidence.episodeIds, [episode._id]) } })
    return known._id
  }
  // The tool as the writer named it: most are brands with their own casing (n8n, not N8n).
  const name = tool
  const text = `${name} broke while I recorded it: ${errorLine(args.error)}.`
  const problemId = await ctx.db.insert('memories', {
    personaId: persona._id,
    kind: 'problem',
    text,
    actor: 'researcher',
    evidence: { episodeIds: [episode._id], signalIds: [] },
    key,
    status: 'active',
    createdAt: args.now,
  })
  await insertCandidate(ctx, {
    personaId: persona._id,
    problemId,
    title: `${name} broke in my recording`,
    summary: text,
    topics: [tool],
    now: args.now,
  })
  return problemId
}

/** What a last check did: kept the concept, or swapped it from one title to another. */
export type LastCheckOutcome = { swapped: false } | { swapped: true; from: string; to: string }

/**
 * Where an idea's first signal stands at the last check: still on the
 * signals with its freshness now, or gone. A used signal never ages out on its
 * own, but the operator can dismiss one on the Signals page, and a dismissed
 * signal ages out (internal/schedule.ts) while its idea can wait up to two
 * weeks for its script day.
 */
type FirstSignal = { kind: 'found'; signal: Doc<'signals'>; freshness: number } | { kind: 'gone' }

/** What the journal says of the signal a swap leaves behind: its title, why it no longer carries the idea, and its evidence. */
function leftBehind(
  first: FirstSignal,
  episode: Pick<Doc<'episodes'>, 'title'>,
  now: number
): { title: string; why: string; signalIds: Id<'signals'>[]; numbers: { label: string; value: number }[] } {
  // The idea's reason left with its signal, so it is swapped like a cold one, and the journal names the idea.
  if (first.kind === 'gone') {
    return {
      title: episode.title,
      why: `"${episode.title}" lost its signal: it is no longer among the signals, so nothing says it still matters.`,
      signalIds: [],
      numbers: [],
    }
  }
  const ageDays = Math.floor(Math.max(0, now - postedAt(first.signal)) / DAY_MS)
  return {
    title: first.signal.title,
    why: `"${first.signal.title}" went cold: its signal is ${plural(ageDays, 'day', 'days')} old, freshness ${first.freshness}.`,
    signalIds: [first.signal._id],
    numbers: [{ label: 'Old freshness', value: first.freshness }],
  }
}

/**
 * The last look before a script is written (writeScript runs it first). Only
 * a reactive idea is checked: its first signal's freshness is read, and when
 * it went cold, or the signal is gone, the persona's freshest new signal at
 * SWAP_MIN_FRESHNESS or above takes its place, through the planner's own
 * signal-to-concept rule (`signalConcept`). The pillar stays; the new signal
 * is used, the old one stays used. One journal entry by the researcher says
 * what changed and why, with no chat message. Nothing fresh enough: nothing
 * changes, and the writer writes the old concept.
 */
export async function lastCheck(ctx: MutationCtx, episodeId: Id<'episodes'>, now: number): Promise<LastCheckOutcome> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  if (episode.status !== 'idea') return { swapped: false }
  const [oldId] = episode.signalIds
  if (oldId === undefined) return { swapped: false }
  const old = await ctx.db.get(oldId)
  const first: FirstSignal = old === null ? { kind: 'gone' } : { kind: 'found', signal: old, freshness: signalFreshness(old, now) }
  if (first.kind === 'found' && !isCold(first.freshness)) return { swapped: false }

  const candidates = await ctx.db
    .query('signals')
    .withIndex('by_persona_status', (q) => q.eq('personaId', episode.personaId).eq('status', 'new'))
    .collect()
  let best: { signal: Doc<'signals'>; freshness: number } | null = null
  for (const signal of candidates) {
    const freshness = signalFreshness(signal, now)
    if (freshness < SWAP_MIN_FRESHNESS) continue
    if (best === null || freshness > best.freshness || (freshness === best.freshness && signal.score > best.signal.score)) {
      best = { signal, freshness }
    }
  }
  if (best === null) return { swapped: false }

  const fresh = best.signal
  const concept = signalConcept(fresh.title)
  await ctx.db.patch(episode._id, { concept, title: concept, signalIds: [fresh._id], updatedAt: now })
  await ctx.db.patch(fresh._id, { status: 'used' })
  const before = leftBehind(first, episode, now)
  await ctx.db.insert('journal', {
    personaId: episode.personaId,
    kind: 'concept_swapped',
    actor: 'researcher',
    text: `Swapped "${before.title}" for "${fresh.title}" on ${shortDayLabel(episode.plannedFor)}.`,
    reason: `${before.why} "${fresh.title}" is the strongest fresh signal (${SIGNAL_SOURCE_LABELS[fresh.source]}, freshness ${best.freshness}).`,
    evidence: {
      episodeIds: [episode._id],
      signalIds: [...before.signalIds, fresh._id],
      numbers: [...before.numbers, { label: 'New freshness', value: best.freshness }],
    },
    createdAt: now,
  })
  return { swapped: true, from: episode.title, to: concept }
}
