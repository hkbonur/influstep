import { CLIP_SECONDS } from '@influstep/shared'
import { z } from 'zod'
import { requireEnv } from '../../lib/env'
import type { MediaProvider, MediaRequest, MediaResult } from './types'

/**
 * The real media provider (docs/plan.md, slice 15): OpenAI's image API for
 * stills, Seedance on BytePlus ModelArk for clips. Which models, their limits
 * and their prices are checked when the keys are set up: the image model and
 * the clip model are read from the deployment, and the Seedance request shape
 * follows ModelArk's video generation task API as documented when this was
 * written. A missing key is an error, never a fallback to the mock (ADR 0002).
 */

const IMAGE_MODEL = 'gpt-image-1'
/** A clip is polled this often, and given up on after this long. */
const POLL_MS = 10_000
const CLIP_TIMEOUT_MS = 8 * 60_000

const imageResponseSchema = z.object({ data: z.array(z.object({ b64_json: z.string() })).min(1) })
const taskCreatedSchema = z.object({ id: z.string() })
const taskSchema = z.object({
  status: z.string(),
  content: z.object({ video_url: z.string() }).optional(),
  error: z.object({ message: z.string() }).nullable().optional(),
})

async function image(request: MediaRequest): Promise<MediaResult> {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: request.prompt,
      size: request.shape === 'square' ? '1024x1024' : '1536x1024',
      n: 1,
    }),
  })
  if (!response.ok) throw new Error(`OpenAI refused the image: ${response.status} ${await response.text()}`)
  const [first] = imageResponseSchema.parse(await response.json()).data
  if (!first) throw new Error('OpenAI returned no image')
  const decoded = atob(first.b64_json)
  const bytes = new ArrayBuffer(decoded.length)
  const view = new Uint8Array(bytes)
  for (let index = 0; index < decoded.length; index += 1) view[index] = decoded.charCodeAt(index)
  return { bytes, contentType: 'image/png', model: IMAGE_MODEL, mock: false }
}

/** A Seedance clip: a task is created, then polled until its video is ready, and the video downloaded. */
async function clip(request: MediaRequest): Promise<MediaResult> {
  const base = requireEnv('ARK_BASE_URL').replace(/\/+$/, '')
  const model = requireEnv('SEEDANCE_MODEL')
  const headers = { Authorization: `Bearer ${requireEnv('ARK_API_KEY')}`, 'Content-Type': 'application/json' }
  const created = await fetch(`${base}/api/v3/contents/generations/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, content: [{ type: 'text', text: `${request.prompt} --ratio 16:9 --duration ${CLIP_SECONDS}` }] }),
  })
  if (!created.ok) throw new Error(`Seedance refused the clip: ${created.status} ${await created.text()}`)
  const { id } = taskCreatedSchema.parse(await created.json())
  const deadline = Date.now() + CLIP_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    const polled = await fetch(`${base}/api/v3/contents/generations/tasks/${encodeURIComponent(id)}`, { headers })
    if (!polled.ok) throw new Error(`Seedance task ${id} could not be read: ${polled.status} ${await polled.text()}`)
    const task = taskSchema.parse(await polled.json())
    if (task.status === 'failed' || task.status === 'cancelled')
      throw new Error(`Seedance task ${id} ${task.status}${task.error ? `: ${task.error.message}` : ''}`)
    if (task.status !== 'succeeded') continue
    if (!task.content) throw new Error(`Seedance task ${id} succeeded without a video`)
    const video = await fetch(task.content.video_url)
    if (!video.ok) throw new Error(`the clip of Seedance task ${id} did not download: ${video.status}`)
    return { bytes: await video.arrayBuffer(), contentType: 'video/mp4', model, mock: false }
  }
  throw new Error(`Seedance task ${id} was not done after ${CLIP_TIMEOUT_MS / 60_000} minutes`)
}

export const realMedia: MediaProvider = {
  name: 'openai + seedance',
  async generate(request) {
    return request.kind === 'image' ? image(request) : clip(request)
  },
}
