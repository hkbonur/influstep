import type { PolledSignalSource } from '@influstep/shared'
import type { FoundSignal, SignalsProvider, SignalsQuery } from './types'

const HOUR_MS = 3_600_000

type Story = { title: string; summary: string; topics: string[] }

/** Search suggestions are made from the query's terms instead (`searchSuggestions`), so they have no fixed stories. */
const STORIES: Record<Exclude<PolledSignalSource, 'search'>, Story[]> = {
  hackernews: [
    {
      title: 'Show HN: I replaced my Zapier bill with n8n on a $5 VPS',
      summary: 'Self-hosting n8n, what broke, and the webhook retry trick that fixed it.',
      topics: ['n8n', 'automation', 'self-hosting'],
    },
    {
      title: 'Ask HN: How do you get customer sign-off inside an automated pipeline?',
      summary: 'Thread about pausing workflows until a client approves a quote.',
      topics: ['workflows', 'approvals', 'customers'],
    },
    {
      title: 'Claude Code and MCP: the agent that files its own tickets',
      summary: 'MCP servers that let an agent act on real tools, with a long comment thread on safety.',
      topics: ['ai agents', 'mcp', 'claude'],
    },
  ],
  reddit: [
    {
      title: 'n8n webhook fails silently when the client sends a form, how do I debug?',
      summary: 'r/n8n thread, 140 comments, most answers are about error workflows.',
      topics: ['n8n', 'webhooks', 'debugging'],
    },
    {
      title: 'What is everyone using to collect documents from clients?',
      summary: 'r/smallbusiness, people complain about chasing emails for PDFs.',
      topics: ['documents', 'customers', 'forms'],
    },
  ],
  google_trends: [
    { title: 'ai agents tutorial', summary: 'Rising query, +140% over 90 days.', topics: ['ai agents', 'tutorial'] },
    { title: 'n8n vs make', summary: 'Breakout query in the last 30 days.', topics: ['n8n', 'make', 'comparison'] },
  ],
  youtube_search: [
    { title: 'n8n beginner tutorial 2026', summary: 'Top result has 400k views and is a year old.', topics: ['n8n', 'tutorial'] },
  ],
}

/**
 * Fixed, plausible stories so demos and tests see the same signals. Their
 * post times sit a fixed number of hours before the poll, a day apart, so a
 * source's stories spread over the last three days. A re-find stamps the
 * post time again (storeSignals), so a mock story never goes cold.
 */
export function mockSignals(source: PolledSignalSource): SignalsProvider {
  return {
    source,
    name: 'mock',
    async find(query: SignalsQuery): Promise<FoundSignal[]> {
      const now = Date.now()
      if (source === 'search') return searchSuggestions(query, now)
      // The fixed stories are about automation and agents; a persona in another niche hears stories about its own terms.
      const fixed = STORIES[source]
      const stories = fixed.some((story) => termBonus(query.terms, story.topics) > 0) ? fixed : nicheStories(source, query.terms)
      return stories.slice(0, query.limit).map((story, index) => ({
        source,
        externalId: `mock-${source}-${index}`,
        title: story.title,
        url: `https://example.com/${source}/${index}`,
        summary: story.summary,
        score: 100 - index * 17 + termBonus(query.terms, story.topics),
        topics: story.topics,
        publishedAt: now - (6 + index * 24) * HOUR_MS,
      }))
    },
  }
}

/** The tools the persona's viewers weigh its own subjects against, one per term the mock suggests for. */
const COMPARED_WITH = ['zapier', 'make'] as const

/**
 * Suggestions shaped like the real adapter's (search.ts), made from the
 * first terms: a how-to and a comparison for each, found within the last day.
 */
function searchSuggestions(query: SignalsQuery, now: number): FoundSignal[] {
  const suggestions = COMPARED_WITH.flatMap((rival, index) => {
    const term = query.terms[index]
    if (term === undefined) return []
    const subject = term.toLowerCase()
    const topics = subject.split(/\s+/).filter((word) => word !== '')
    return [`how to get started with ${subject}`, `${subject} vs ${rival}`].map((suggestion) => ({ suggestion, topics }))
  })
  return suggestions.slice(0, query.limit).map((entry, rank) => ({
    source: 'search',
    externalId: entry.suggestion,
    title: entry.suggestion,
    url: `https://www.google.com/search?q=${encodeURIComponent(entry.suggestion)}`,
    summary: `People type "${entry.suggestion}" into Google.`,
    score: Math.max(30, 70 - rank * 5),
    topics: entry.topics,
    publishedAt: now - (2 + rank * 4) * HOUR_MS,
  }))
}

/** Stories shaped like the source's, about the persona's first two terms; none without a term. */
export function nicheStories(source: Exclude<PolledSignalSource, 'search'>, terms: string[]): Story[] {
  const [first, second = first] = terms.map((term) => term.toLowerCase())
  if (first === undefined || second === undefined) return []
  const topics = (term: string) => term.split(/\s+/).filter((word) => word !== '')
  const by: Record<Exclude<PolledSignalSource, 'search'>, Story[]> = {
    hackernews: [
      {
        title: `Ask HN: What does your ${first} setup look like?`,
        summary: `A long thread of people comparing how they do ${first}.`,
        topics: topics(first),
      },
      {
        title: `Show HN: I automated the boring part of ${second}`,
        summary: `What it saved, and what still needs a human.`,
        topics: topics(second),
      },
    ],
    reddit: [
      {
        title: `What do you wish you knew before starting with ${first}?`,
        summary: `Beginners' regrets, 90 comments.`,
        topics: topics(first),
      },
      {
        title: `${second} keeps going wrong, what am I missing?`,
        summary: `Most answers point at the same setting.`,
        topics: topics(second),
      },
    ],
    google_trends: [{ title: `${first} tutorial`, summary: 'Rising query, +80% over 90 days.', topics: topics(first) }],
    youtube_search: [{ title: `${first} for beginners`, summary: 'The top result is two years old.', topics: topics(first) }],
  }
  return by[source]
}

function termBonus(terms: string[], topics: string[]): number {
  const lower = terms.map((term) => term.toLowerCase())
  return topics.filter((topic) => lower.some((term) => term.includes(topic) || topic.includes(term))).length * 10
}
