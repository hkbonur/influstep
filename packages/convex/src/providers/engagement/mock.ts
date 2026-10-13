import type { HeardPost, ReplyCounts } from '@influstep/shared'
import type { EngagementProvider, ListenQuery } from './types'

/**
 * The mock listener: plausible posts from the persona's pillars until X
 * search access exists. Each three-hour window hears a fresh set, seeded by
 * the handle and the window, so a second sweep in the same window hears the
 * same posts (and answers none of them twice), and the next window hears new
 * ones. The set always holds a mention, a reply under the persona's post,
 * found posts with large and small reach, one too old to answer, and, in
 * turn, a post naming the sponsor and a post about politics, so every filter
 * and a rule like "never reply to politics" has something to act on.
 */

const WINDOW_MS = 3 * 3_600_000
const HOUR_MS = 3_600_000

interface Author {
  handle: string
  name: string
  followers: number
}

const AUTHORS: Author[] = [
  { handle: 'dana_automates', name: 'Dana Ruiz', followers: 12_400 },
  { handle: 'opsjoe', name: 'Joe Park', followers: 3_100 },
  { handle: 'buildwithkai', name: 'Kai Lund', followers: 25_800 },
  { handle: 'mira_ships', name: 'Mira Chen', followers: 5_400 },
  { handle: 'nocode_nina', name: 'Nina Vos', followers: 860 },
  { handle: 'tomtries', name: 'Tom Ek', followers: 410 },
]

const FOUND: ((pillar: string) => string)[] = [
  (pillar) => `Spent all day on ${inSentence(pillar)}. Why does nobody talk about what happens when a step fails halfway?`,
  (pillar) => `What's your go-to setup for ${inSentence(pillar)}? Mine keeps breaking on Mondays.`,
  (pillar) => `Unpopular opinion: most ${inSentence(pillar)} tutorials skip the only hard part, the error path.`,
  (pillar) => `Is ${inSentence(pillar)} still worth learning, or is it all agents now?`,
  (pillar) => `Three weeks into ${inSentence(pillar)} and I finally get why people name every step.`,
]

const MENTIONS: ((handle: string, pillar: string) => string)[] = [
  (handle, pillar) => `@${handle} what do you check first when ${inSentence(pillar)} breaks overnight?`,
  (handle) => `@${handle} your last thread saved my Monday. Do you cap retries or alert on every failure?`,
]

const REPLIES_UNDER: string[] = [
  'Tried this, and the retry part broke for me. Any idea why it ran twice?',
  'Does this still work when the customer never answers?',
]

/** One item of a list by a seeded index; the lists are constants, so an empty one is a bug. */
function pick<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length]
  if (item === undefined) throw new Error('the mock listener picked from an empty list')
  return item
}

/** A pillar inside a sentence: "Automation fails" reads "automation fails", while "AI agents" and "n8n" keep their case. */
function inSentence(pillar: string): string {
  return /^[A-Z][a-z]/.test(pillar) ? pillar.charAt(0).toLowerCase() + pillar.slice(1) : pillar
}

/** The window's posts, newest first; a sponsor post on even windows, a politics post on odd ones. */
function windowPosts(query: ListenQuery): HeardPost[] {
  const window = Math.floor(query.now / WINDOW_MS)
  const seed = hash(`${query.handle}:${window}`)
  const pillars = query.pillars.length > 0 ? query.pillars : [query.niche]
  const pillarAt = (index: number) => pick(pillars, seed + index)
  const authorAt = (index: number) => pick(AUTHORS, seed + index)
  const post = (
    index: number,
    origin: HeardPost['origin'],
    text: string,
    at: { hoursAgo: number; author: Author; pillar: string | null }
  ) => {
    const externalId = `${1_840_000_000_000 + (seed % 1_000_000) * 100 + index}`
    return {
      origin,
      externalId,
      text,
      url: `https://x.com/${at.author.handle}/status/${externalId}`,
      postedAt: query.now - at.hoursAgo * HOUR_MS,
      author: at.author,
      pillar: at.pillar,
    }
  }
  const posts: HeardPost[] = [
    post(0, 'mention', pick(MENTIONS, seed)(query.handle, pillarAt(0)), { hoursAgo: 1, author: authorAt(5), pillar: null }),
    post(1, 'reply', pick(REPLIES_UNDER, seed), { hoursAgo: 2, author: authorAt(4), pillar: null }),
  ]
  for (let index = 0; index < 4; index += 1) {
    const pillar = pillarAt(index)
    // The fourth found post is too old to answer.
    const hoursAgo = index === 3 ? 20 : 1 + index * 2
    posts.push(post(2 + index, 'search', pick(FOUND, seed + index)(pillar), { hoursAgo, author: authorAt(index), pillar }))
  }
  const big = pick(AUTHORS, 2)
  posts.push(
    window % 2 === 0
      ? post(6, 'search', `Has anyone tried ${query.sponsorName} for client intake? Looking for something my flow can send.`, {
          hoursAgo: 3,
          author: big,
          pillar: pillarAt(1),
        })
      : post(6, 'search', `Politics aside, the new AI bill could change ${inSentence(pillarAt(2))} for small shops overnight.`, {
          hoursAgo: 2,
          author: big,
          pillar: pillarAt(2),
        })
  )
  return posts.sort((a, b) => b.postedAt - a.postedAt)
}

export const mockEngagement: EngagementProvider = {
  name: 'mock',
  async listen(query) {
    return windowPosts(query)
  },
  async counts(args): Promise<ReplyCounts> {
    const hours = Math.max(0, (Date.now() - args.sentAt) / HOUR_MS)
    const seed = hash(args.externalId)
    const impressions = Math.round((150 + (seed % 900)) * Math.log2(2 + Math.min(hours, 72)))
    return {
      impressions,
      likes: Math.round(impressions * 0.03),
      replies: Math.round(impressions * 0.004),
      profileVisits: Math.round(impressions * 0.02),
      // Most replies bring nobody; some bring a few.
      follows: Math.round((impressions * (seed % 5)) / 1000),
    }
  },
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return Math.abs(h >>> 0)
}
