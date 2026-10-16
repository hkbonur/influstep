import fs from 'node:fs/promises'
import path from 'node:path'
import type { Shot } from '@influstep/shared'
import { z } from 'zod'
import { requireEnv } from './config'
import { ffmpeg } from './ffmpeg'
import { spokenSeconds } from './voice'

/**
 * The avatar provider (docs/plan.md, slice 17): the persona's portrait,
 * animated to speak a stretch of its own voice track. HeyGen's Avatar IV,
 * fed the image and our audio, so the persona keeps one face and one voice.
 * A take is square, so one take serves every cut (core `takeClip` fits it).
 * Mock mode never calls it: a mock take is a card (record.ts).
 */

const HEYGEN = 'https://api.heygen.com'
/** A take is polled this often, and given up on after this long. */
const POLL_MS = 10_000
const TAKE_TIMEOUT_MS = 15 * 60_000

/** Where each shot starts on the voice track: the shots are cut to their spoken length, one after another. */
export function shotStarts(shots: readonly Pick<Shot, 'voiceover'>[]): number[] {
  const starts: number[] = []
  let at = 0
  for (const shot of shots) {
    starts.push(at)
    at += spokenSeconds(shot.voiceover)
  }
  return starts
}

/** The portrait a take is made from, as the runner downloaded it. */
export interface Portrait {
  file: string
  contentType: string
}

/** HeyGen's request for one take: the portrait animated to our audio, square, at 720p, a little expressive. */
export function heygenTakeBody(args: { imageAssetId: string; audioAssetId: string; title: string }) {
  return {
    type: 'image',
    image: { type: 'asset_id', asset_id: args.imageAssetId },
    audio_asset_id: args.audioAssetId,
    aspect_ratio: '1:1',
    resolution: '720p',
    expressiveness: 'medium',
    title: args.title,
  }
}

const uploadedSchema = z.object({ data: z.object({ asset_id: z.string() }) })
const createdSchema = z.object({ data: z.object({ video_id: z.string() }) })
const videoSchema = z.object({
  data: z.object({
    status: z.enum(['pending', 'processing', 'completed', 'failed']),
    video_url: z.string().nullable().optional(),
    failure_message: z.string().nullable().optional(),
  }),
})

async function heygenUpload(apiKey: string, file: string, contentType: string): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([await fs.readFile(file)], { type: contentType }), path.basename(file))
  const response = await fetch(`${HEYGEN}/v3/assets`, { method: 'POST', headers: { 'x-api-key': apiKey }, body: form })
  if (!response.ok) throw new Error(`HeyGen refused the upload of ${path.basename(file)}: ${response.status} ${await response.text()}`)
  return uploadedSchema.parse(await response.json()).data.asset_id
}

/**
 * HeyGen takes PNG and JPEG portraits. Another picture the browser decodes
 * (WebP) is turned into PNG; a mock card (SVG) is no face at all.
 */
async function heygenPortrait(portrait: Portrait, dir: string): Promise<Portrait> {
  if (portrait.contentType === 'image/png' || portrait.contentType === 'image/jpeg') return portrait
  if (portrait.contentType === 'image/svg+xml')
    throw new Error(
      'The portrait is a mock card, not a face: generate the portrait again with real providers, or upload a picture of the look.'
    )
  const out = path.join(dir, 'portrait.png')
  await ffmpeg(['-i', portrait.file, '-frames:v', '1', out])
  return { file: out, contentType: 'image/png' }
}

/**
 * One persona's takes in one job: the portrait is uploaded once and every
 * take reuses it. Each take uploads its WAV, asks HeyGen to animate the
 * portrait to it, polls until it is done and downloads it.
 */
export async function heygenTakes(portrait: Portrait, dir: string) {
  const apiKey = requireEnv('HEYGEN_API_KEY')
  await fs.mkdir(dir, { recursive: true })
  const image = await heygenPortrait(portrait, dir)
  let imageAssetId: string | null = null
  return {
    async take(args: { audio: string; out: string; title: string }): Promise<string> {
      imageAssetId ??= await heygenUpload(apiKey, image.file, image.contentType)
      const audioAssetId = await heygenUpload(apiKey, args.audio, 'audio/wav')
      const created = await fetch(`${HEYGEN}/v3/videos`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(heygenTakeBody({ imageAssetId, audioAssetId, title: args.title })),
      })
      if (!created.ok) throw new Error(`HeyGen refused the take: ${created.status} ${await created.text()}`)
      const { video_id: videoId } = createdSchema.parse(await created.json()).data
      const deadline = Date.now() + TAKE_TIMEOUT_MS
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        const polled = await fetch(`${HEYGEN}/v3/videos/${encodeURIComponent(videoId)}`, { headers: { 'x-api-key': apiKey } })
        if (!polled.ok) throw new Error(`HeyGen take ${videoId} could not be read: ${polled.status} ${await polled.text()}`)
        const video = videoSchema.parse(await polled.json()).data
        if (video.status === 'failed') throw new Error(`HeyGen take ${videoId} failed: ${video.failure_message ?? 'no reason given'}`)
        if (video.status !== 'completed') continue
        if (!video.video_url) throw new Error(`HeyGen take ${videoId} completed without a video`)
        const download = await fetch(video.video_url)
        if (!download.ok) throw new Error(`HeyGen take ${videoId} did not download: ${download.status}`)
        await fs.writeFile(args.out, Buffer.from(await download.arrayBuffer()))
        return args.out
      }
      throw new Error(`HeyGen take ${videoId} was not done after ${TAKE_TIMEOUT_MS / 60_000} minutes`)
    },
  }
}
