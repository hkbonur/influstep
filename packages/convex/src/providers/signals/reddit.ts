import { z } from 'zod'
import type { FoundSignal, SignalsProvider, SignalsQuery } from './types'

const childSchema = z.object({
  data: z.object({
    id: z.string(),
    title: z.string(),
    permalink: z.string(),
    score: z.number(),
    num_comments: z.number(),
    created_utc: z.number(),
    subreddit: z.string(),
    selftext: z.string().optional(),
  }),
})
const listingSchema = z.object({ data: z.object({ children: z.array(childSchema) }) })

/**
 * Reddit's public search JSON. No key, but Reddit throttles anonymous clients
 * hard, so the researcher runs this hourly at most and sends a named agent.
 */
export const redditSignals: SignalsProvider = {
  source: 'reddit',
  name: 'public-json',
  async find(query: SignalsQuery): Promise<FoundSignal[]> {
    const found: FoundSignal[] = []
    for (const term of query.terms) {
      const url = new URL('https://www.reddit.com/search.json')
      url.searchParams.set('q', term)
      url.searchParams.set('sort', 'top')
      url.searchParams.set('t', 'week')
      url.searchParams.set('limit', String(query.limit))
      const response = await fetch(url, { headers: { 'User-Agent': 'influstep-researcher/0.1' } })
      if (!response.ok) throw new Error(`Reddit search failed: ${response.status} ${response.statusText}`)
      const parsed = listingSchema.parse(await response.json())
      for (const child of parsed.data.children) {
        const post = child.data
        if (post.created_utc * 1000 < query.since) continue
        found.push({
          source: 'reddit',
          externalId: post.id,
          title: post.title,
          url: `https://www.reddit.com${post.permalink}`,
          summary: `r/${post.subreddit}, ${post.num_comments} comments. ${(post.selftext ?? '').slice(0, 160)}`.trim(),
          score: post.score + post.num_comments * 2,
          topics: [term, post.subreddit],
          publishedAt: post.created_utc * 1000,
        })
      }
    }
    return found.sort((a, b) => b.score - a.score).slice(0, query.limit)
  },
}
