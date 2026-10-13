import { X_POST_LIMIT, xLength } from './posts'

/**
 * Engagement on X (docs/plan.md, slice 11): an X persona also grows by
 * answering other people. The listener finds posts worth answering, the
 * writer drafts a reply or skips the post, and the reply goes out within
 * the persona's daily reply budget. Who presses the button follows X's
 * automation rules: a reply to someone who engaged with the persona first
 * may go out on its own, a reply to a stranger's post waits for the operator.
 * Influstep never likes, reposts or follows.
 */

/**
 * Where the post a reply answers came from: a post that mentions the
 * persona, a reply under one of its own posts, or a post in its pillars the
 * listener found by searching.
 */
export const REPLY_ORIGINS = ['mention', 'reply', 'search'] as const
export type ReplyOrigin = (typeof REPLY_ORIGINS)[number]

export const REPLY_ORIGIN_LABELS: Record<ReplyOrigin, string> = {
  mention: 'Mentioned the persona',
  reply: 'Replied to its post',
  search: 'Found by the listener',
}

/**
 * Whether the author engaged with the persona first. Only then may a reply
 * go out without the operator: X forbids automated replies to posts chosen
 * by a keyword search, so a found post's reply is always posted by hand.
 */
export function engagedFirst(origin: ReplyOrigin): boolean {
  return origin !== 'search'
}

/**
 * Heard: found, not written yet. Draft: written, waiting for the operator to
 * post it. Queued: going out on its own within the budget. Sending: handed
 * to the runner. Sent: on X. Failed: X or the runner refused it. Skipped: the
 * writer, a rule, the sponsor filter or the operator passed on it, or the
 * draft went stale.
 */
export const REPLY_STATUSES = ['heard', 'draft', 'queued', 'sending', 'sent', 'failed', 'skipped'] as const
export type ReplyStatus = (typeof REPLY_STATUSES)[number]

export const REPLY_STATUS_LABELS: Record<ReplyStatus, string> = {
  heard: 'Being written',
  draft: 'Waiting for you',
  queued: 'Goes out on its own',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Skipped',
}

/** How many replies a persona sends a day, by hand and on its own together. Zero turns listening off. */
export const REPLIES_PER_DAY_MIN = 0
export const REPLIES_PER_DAY_MAX = 20
export const REPLIES_PER_DAY_DEFAULT = 5

/** A found post needs an author with this many followers: a reply under a post nobody reads brings nobody back. */
export const REPLY_REACH_MIN = 1000

const HOUR_MS = 3_600_000

/** How old a post may be to still get an answer: a found post goes cold within the day, a mention keeps two. */
export const REPLY_FRESH_MS: Record<ReplyOrigin, number> = {
  mention: 48 * HOUR_MS,
  reply: 48 * HOUR_MS,
  search: 12 * HOUR_MS,
}

/** A draft nobody posted within a day answers a conversation that moved on, so it is skipped as stale. */
export const DRAFT_STALE_MS = 24 * HOUR_MS

/** How long the analyst keeps reading a sent reply's numbers: a reply's reach is spent within the week. */
export const REPLY_MEASURE_MS = 7 * 24 * HOUR_MS

/** A post the listener heard, as the engagement provider returns it. */
export interface HeardPost {
  origin: ReplyOrigin
  /** The X id of the post. */
  externalId: string
  text: string
  url: string
  postedAt: number
  author: { handle: string; name: string; followers: number }
  /** The pillar a search matched it on; null for a mention or a reply. */
  pillar: string | null
}

/** What a sent reply brought back, as X counts it. */
export interface ReplyCounts {
  impressions: number
  likes: number
  replies: number
  profileVisits: number
  follows: number
}

/**
 * What becomes of a heard post: kept for the writer, dropped unseen (too old,
 * too little reach, already answered, the persona's own), or kept as skipped
 * with the reason the operator reads (it names the sponsor).
 */
export type HeardVerdict = { kind: 'keep' } | { kind: 'drop'; reason: string } | { kind: 'skip'; reason: string }

export function heardVerdict(
  post: HeardPost,
  context: { personaHandle: string; sponsorName: string; answered: ReadonlySet<string>; now: number }
): HeardVerdict {
  if (sameHandle(post.author.handle, context.personaHandle)) return { kind: 'drop', reason: 'the persona wrote it' }
  if (context.answered.has(post.externalId)) return { kind: 'drop', reason: 'already answered or passed on' }
  if (context.now - post.postedAt > REPLY_FRESH_MS[post.origin]) return { kind: 'drop', reason: 'too old to answer' }
  if (post.origin === 'search' && post.author.followers < REPLY_REACH_MIN)
    return { kind: 'drop', reason: `fewer than ${REPLY_REACH_MIN} followers` }
  if (namesSponsor(post.text, context.sponsorName))
    return { kind: 'skip', reason: `It names ${context.sponsorName}; the persona answers about its sponsor only when you ask.` }
  return { kind: 'keep' }
}

function sameHandle(a: string, b: string): boolean {
  return a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase()
}

/** Whether the text names the sponsor as a word, in any case ("formstep", "Formstep's"). */
export function namesSponsor(text: string, sponsorName: string): boolean {
  const name = sponsorName.trim().toLowerCase()
  if (name === '') return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(text)
}

const LINK = /https?:\/\/|www\./i

/**
 * Why a reply cannot go out as written: X's limit, a link (a reply that
 * links reads as spam and X ranks it down), or the sponsor's name where the
 * operator did not ask for it. Empty when it can.
 */
export function replyProblems(text: string, context: { sponsorName: string; sponsorAllowed: boolean }): string[] {
  const problems: string[] = []
  const trimmed = text.trim()
  if (trimmed === '') return ['Write the reply.']
  const length = xLength(trimmed)
  if (length > X_POST_LIMIT) problems.push(`A reply is at most ${X_POST_LIMIT} characters; this one is ${length}.`)
  if (LINK.test(trimmed)) problems.push('Leave links out of a reply.')
  if (!context.sponsorAllowed && namesSponsor(trimmed, context.sponsorName))
    problems.push(`Leave ${context.sponsorName} out of this reply; nobody asked about it.`)
  return problems
}

/** How many more replies the budget allows today. */
export function repliesLeft(budget: number, sentToday: number): number {
  return Math.max(0, budget - sentToday)
}

/**
 * A rule about whom or what the persona answers ("never reply to politics",
 * "only reply to people building agents", "don't answer anyone selling
 * courses"). The chat stores one as a rule in memory with or without
 * "remember" (shared `parseChatIntent`), and the writer reads it before every
 * reply.
 */
export const REPLY_RULE = /^(?:never|don't|do not|dont|no|stop|only)\s+(?:reply|replies|replying|answer|answering)\b/i

const REPLY_RULE_SUBJECT =
  /^(never|don't|do not|dont|no|stop|only)\s+(?:reply|replies|replying|answer|answering)(?:\s+(?:to|under))?\s+(?:posts?\s+(?:about|on|from)\s+|anything\s+(?:about|on)\s+|anyone\s+|people\s+|someone\s+)?(.+?)[.!]*$/i

/** Words that say who or what in any rule, so they never decide whether a post is covered. */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'about',
  'anyone',
  'anything',
  'folks',
  'people',
  'post',
  'posts',
  'someone',
  'that',
  'their',
  'them',
  'they',
  'those',
  'what',
  'which',
  'with',
  'who',
])

/**
 * What a reply rule covers, read word for word: "never" rules pass on a post
 * that holds one of the subject's words, "only" rules pass on a post that
 * holds none. A plural loses its "s", so "agents" covers "agent". Null when
 * the sentence is no reply rule. The mock writer reads rules this way; the
 * real writer reads them as sentences.
 */
export function replyRuleOf(rule: string): { kind: 'never' | 'only'; words: string[] } | null {
  const match = REPLY_RULE_SUBJECT.exec(rule.trim())
  if (!match?.[1] || !match[2]) return null
  const words = match[2]
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word))
    .map((word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word))
  if (words.length === 0) return null
  return { kind: match[1].toLowerCase() === 'only' ? 'only' : 'never', words }
}

/** Whether a reply rule tells the persona to pass on this post. */
export function replyRuleCovers(rule: string, postText: string): boolean {
  const read = replyRuleOf(rule)
  if (!read) return false
  const text = postText.toLowerCase()
  const holds = read.words.some((word) => text.includes(word))
  return read.kind === 'never' ? holds : !holds
}
