import { z } from 'zod'
import type { FoundSignal, SignalsProvider, SignalsQuery } from './types'

const hitSchema = z.object({
  objectID: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  points: z.number().nullable(),
  num_comments: z.number().nullable(),
  created_at_i: z.number(),
})
const responseSchema = z.object({ hits: z.array(hitSchema) })

/** Hacker News through the Algolia search API. No key needed. */
export const hackerNewsSignals: SignalsProvider = {
  source: 'hackernews',
  name: 'algolia',
  async find(query: SignalsQuery): Promise<FoundSignal[]> {
    const found: FoundSignal[] = []
    for (const term of query.terms) {
      const url = new URL('https://hn.algolia.com/api/v1/search')
      url.searchParams.set('query', term)
      url.searchParams.set('tags', 'story')
      url.searchParams.set('numericFilters', `created_at_i>${Math.floor(query.since / 1000)}`)
      url.searchParams.set('hitsPerPage', String(query.limit))
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Hacker News search failed: ${response.status} ${response.statusText}`)
      const parsed = responseSchema.parse(await response.json())
      for (const hit of parsed.hits) {
        if (!hit.title) continue
        found.push({
          source: 'hackernews',
          externalId: hit.objectID,
          title: hit.title,
          url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
          summary: `${hit.points ?? 0} points, ${hit.num_comments ?? 0} comments`,
          score: (hit.points ?? 0) + (hit.num_comments ?? 0) * 2,
          topics: [term],
          publishedAt: hit.created_at_i * 1000,
        })
      }
    }
    return dedupe(found)
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit)
  },
}

function dedupe(signals: FoundSignal[]): FoundSignal[] {
  const seen = new Map<string, FoundSignal>()
  for (const signal of signals) {
    const existing = seen.get(signal.externalId)
    if (existing) {
      existing.topics = [...new Set([...existing.topics, ...signal.topics])]
      continue
    }
    seen.set(signal.externalId, signal)
  }
  return [...seen.values()]
}
