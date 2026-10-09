import type { SignalSource } from '@influstep/shared'
import type { FoundSignal, SignalsProvider, SignalsQuery } from './types'

const STORIES: Record<SignalSource, { title: string; summary: string; topics: string[] }[]> = {
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
  comments: [
    {
      title: 'Can you show how to retry a failed webhook step?',
      summary: 'Asked under last week’s episode, 12 likes.',
      topics: ['n8n', 'webhooks'],
    },
    {
      title: 'Which form tool is that? Does it work with Zapier?',
      summary: 'Three viewers asked the same thing.',
      topics: ['forms', 'zapier'],
    },
  ],
  youtube_search: [
    { title: 'n8n beginner tutorial 2026', summary: 'Top result has 400k views and is a year old.', topics: ['n8n', 'tutorial'] },
  ],
}

/** Fixed, plausible stories so demos and tests see the same signals. */
export function mockSignals(source: SignalSource): SignalsProvider {
  return {
    source,
    name: 'mock',
    async find(query: SignalsQuery): Promise<FoundSignal[]> {
      const stories = STORIES[source]
      return stories.slice(0, query.limit).map((story, index) => ({
        source,
        externalId: `mock-${source}-${index}`,
        title: story.title,
        url: `https://example.com/${source}/${index}`,
        summary: story.summary,
        score: 100 - index * 17 + termBonus(query.terms, story.topics),
        topics: story.topics,
      }))
    },
  }
}

function termBonus(terms: string[], topics: string[]): number {
  const lower = terms.map((term) => term.toLowerCase())
  return topics.filter((topic) => lower.some((term) => term.includes(topic) || topic.includes(term))).length * 10
}
