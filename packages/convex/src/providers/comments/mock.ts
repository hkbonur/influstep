import type { Platform } from '@influstep/shared'
import type { PlatformComment, PlatformCounts, PlatformProvider } from './types'

const COMMENTS = [
  'Can you show how to retry a failed webhook step?',
  'Which form tool is that? Does it work with Zapier?',
  'This saved my Monday. Subscribed.',
  'What about error handling when the client never answers?',
]

/** How far one platform's reach runs ahead of YouTube's. X reports impressions, which are many and fill the views count. */
const REACH: Record<Platform, number> = { youtube: 1, tiktok: 2.4, instagram: 1.3, x: 3 }

/** Counts grow with time since publish, seeded by the id, so the report shows movement. */
export function mockPlatform(platform: Platform): PlatformProvider {
  return {
    platform,
    name: 'mock',
    async comments(externalId: string): Promise<PlatformComment[]> {
      const seed = hash(externalId)
      return COMMENTS.slice(0, 2 + (seed % 3)).map((text, index) => ({
        externalId: `${externalId}-c${index}`,
        text,
        likes: (seed + index * 7) % 20,
        at: Date.now() - index * 3_600_000,
      }))
    },
    async counts(args): Promise<PlatformCounts> {
      const hours = Math.max(0, (Date.now() - args.publishedAt) / 3_600_000)
      const seed = hash(args.externalId)
      const base = 400 + (seed % 900)
      const views = Math.round(base * Math.log2(2 + hours) * REACH[platform])
      return {
        views,
        likes: Math.round(views * 0.06),
        comments: Math.round(views * 0.004),
        follows: Math.round(views * 0.012),
        // A post on X has no watch time, and a video's needs the real adapter, so X reports none, as YouTube's key-only reads do.
        watchRate: platform === 'x' ? 0 : 0.35 + (seed % 30) / 100,
      }
    },
  }
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return Math.abs(h >>> 0)
}
