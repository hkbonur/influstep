import { z } from 'zod'
import { requireEnv } from '../../lib/env'
import type { PlatformComment, PlatformCounts, PlatformProvider } from './types'

const commentsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({
        topLevelComment: z.object({
          snippet: z.object({ textOriginal: z.string(), likeCount: z.number(), publishedAt: z.string() }),
        }),
      }),
    })
  ),
})

const videosSchema = z.object({
  items: z.array(
    z.object({
      statistics: z.object({ viewCount: z.string(), likeCount: z.string().optional(), commentCount: z.string().optional() }),
    })
  ),
})

/** YouTube Data API v3 reads with an API key. Follows and watch rate need the channel's OAuth, so they stay 0 here. */
export const youtubePlatform: PlatformProvider = {
  platform: 'youtube',
  name: 'youtube-data-api',
  async comments(externalId: string): Promise<PlatformComment[]> {
    const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads')
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('videoId', externalId)
    url.searchParams.set('maxResults', '50')
    url.searchParams.set('key', requireEnv('YOUTUBE_API_KEY'))
    const response = await fetch(url)
    if (!response.ok) throw new Error(`YouTube comments failed: ${response.status} ${await response.text()}`)
    const parsed = commentsSchema.parse(await response.json())
    return parsed.items.map((item) => ({
      externalId: item.id,
      text: item.snippet.topLevelComment.snippet.textOriginal,
      likes: item.snippet.topLevelComment.snippet.likeCount,
      at: new Date(item.snippet.topLevelComment.snippet.publishedAt).getTime(),
    }))
  },
  async counts(args): Promise<PlatformCounts> {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos')
    url.searchParams.set('part', 'statistics')
    url.searchParams.set('id', args.externalId)
    url.searchParams.set('key', requireEnv('YOUTUBE_API_KEY'))
    const response = await fetch(url)
    if (!response.ok) throw new Error(`YouTube stats failed: ${response.status} ${await response.text()}`)
    const parsed = videosSchema.parse(await response.json())
    const stats = parsed.items[0]?.statistics
    if (!stats) throw new Error(`YouTube video ${args.externalId} not found`)
    return {
      views: Number(stats.viewCount),
      likes: Number(stats.likeCount ?? 0),
      comments: Number(stats.commentCount ?? 0),
      follows: 0,
      watchRate: 0,
    }
  },
}
