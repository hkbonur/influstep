import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Platform, PostReplyPayload, PublishPayload, PublishResult } from '@influstep/shared'
import { artifactsDir, providersMode, requireEnv } from './config'

type VideoPayload = Extract<PublishPayload, { kind: 'video' }>

/**
 * The publisher's upload. Mock: a fake id and URL, marked as such. Real:
 * YouTube Data API multipart upload with an access token; TikTok and
 * Instagram need their app review first and say so. X, posts and videos
 * alike, has no adapter yet and says which key it waits for.
 */
export async function publish(job: { id: string; payload: PublishPayload }): Promise<PublishResult> {
  const { payload } = job
  if (payload.platform === 'x') return mockXPost(payload.publicationId)
  if (providersMode() === 'mock') {
    const externalId = `mock-${payload.platform}-${payload.publicationId.slice(-6)}`
    return { externalId, url: mockUrl(payload.platform, externalId), publishedAt: Date.now(), mock: true }
  }
  if (payload.platform !== 'youtube')
    throw new Error(`${payload.platform} publishing needs the platform's app review; connect it on the Providers page`)
  return uploadToYouTube(payload)
}

/**
 * A reply goes out through the same X adapter as a post, in reply to the
 * post it answers. Mock: an id derived from the reply, as for a post.
 */
export async function postReply(job: { id: string; payload: PostReplyPayload }): Promise<PublishResult> {
  return mockXPost(`reply:${job.payload.replyId}`)
}

/**
 * X has no adapter yet, so real mode refuses by name. Mock: an id derived from
 * the publication or the reply, so a retried job reports the same post. The
 * payload names no handle, so the URL takes the form X itself resolves
 * without one.
 */
function mockXPost(key: string): PublishResult {
  if (providersMode() === 'real') throw new Error(X_NEEDS_OAUTH)
  const externalId = `x-mock-${createHash('sha256').update(key).digest('hex').slice(0, 8)}`
  return { externalId, url: `https://x.com/i/status/${externalId}`, publishedAt: Date.now(), mock: true }
}

const X_NEEDS_OAUTH = 'X publishing needs X_OAUTH; the X adapter is not built yet.'

function mockUrl(platform: Exclude<Platform, 'x'>, externalId: string): string {
  if (platform === 'youtube') return `https://www.youtube.com/watch?v=${externalId}`
  if (platform === 'tiktok') return `https://www.tiktok.com/@persona/video/${externalId}`
  return `https://www.instagram.com/reel/${externalId}/`
}

async function uploadToYouTube(payload: VideoPayload): Promise<PublishResult> {
  const token = requireEnv('YOUTUBE_ACCESS_TOKEN')
  const file = path.join(artifactsDir, 'uploads', `${payload.publicationId}.mp4`)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const download = await fetch(payload.renderUrl)
  if (!download.ok) throw new Error(`could not download the render: ${download.status}`)
  const video = Buffer.from(await download.arrayBuffer())
  const metadata = {
    snippet: { title: payload.title.slice(0, 100), description: payload.description.slice(0, 5000), categoryId: '28' },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  }
  const boundary = `influstep-${Date.now()}`
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`
  )
  const tail = Buffer.from(`\r\n--${boundary}--`)
  const response = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([head, video, tail]),
  })
  if (!response.ok) throw new Error(`YouTube refused the upload: ${response.status} ${await response.text()}`)
  const result = (await response.json()) as { id?: string }
  if (!result.id) throw new Error('YouTube returned no video id')
  return { externalId: result.id, url: `https://www.youtube.com/watch?v=${result.id}`, publishedAt: Date.now(), mock: false }
}
