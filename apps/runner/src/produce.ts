import fs from 'node:fs/promises'
import path from 'node:path'
import { X_IMAGE_ASPECT, type AspectRatio, type ProducePayload, type ProduceResult, type Shot } from '@influstep/shared'
import { backend } from './backend'
import { artifactsDir, providersMode } from './config'
import { SIZE, fitClip, joinWithVoice, stillClip } from './ffmpeg'
import { recordScreen, renderTitleCard } from './record'
import { makeVoice, spokenSeconds } from './voice'

type VideoPayload = Extract<ProducePayload, { kind: 'video' }>
type ImagePayload = Extract<ProducePayload, { kind: 'image' }>

/**
 * The producer: one clip per shot (a screen recording in real mode, a title
 * card in mock mode), the voice track, then one render per aspect ratio,
 * uploaded to Convex storage. An image post is one title card and nothing else.
 */
export async function produce(job: { id: string; payload: ProducePayload }): Promise<ProduceResult> {
  if (job.payload.kind === 'image') return produceImage(job.payload)
  return produceVideo(job.payload)
}

/**
 * An image post's card: the card title on the 16:9 card X shows under the
 * post, with the persona's name and handle. No voice. The card itself is the
 * same in both modes; the render carries the providers mode like a video's,
 * because the post's publication takes its mock flag from its renders.
 */
async function produceImage(payload: ImagePayload): Promise<ProduceResult> {
  const dir = path.join(artifactsDir, payload.episodeId)
  await fs.mkdir(dir, { recursive: true })
  const { width, height } = SIZE[X_IMAGE_ASPECT]
  const card = await renderTitleCard({
    title: payload.cardTitle,
    subtitle: `${payload.personaName} · @${payload.handle}`,
    out: path.join(dir, 'card.png'),
    width,
    height,
  })
  const storageId = await backend.upload(card, 'image/png')
  return { renders: [{ aspect: X_IMAGE_ASPECT, storageId, durationSec: 0, mock: providersMode() === 'mock' }] }
}

async function produceVideo(payload: VideoPayload): Promise<ProduceResult> {
  const dir = path.join(artifactsDir, payload.episodeId)
  await fs.mkdir(dir, { recursive: true })
  const mock = providersMode() === 'mock'

  const voiceText = payload.shots.map((shot) => shot.voiceover).join(' ')
  const voice = await makeVoice({ text: voiceText, voiceId: payload.voiceId, out: path.join(dir, 'voice.m4a') })

  const renders: ProduceResult['renders'] = []
  for (const aspect of payload.aspects) {
    const clips: string[] = []
    for (const [index, shot] of payload.shots.entries()) {
      const seconds = spokenSeconds(shot.voiceover)
      const out = path.join(dir, `shot-${index + 1}-${aspect.replace(':', 'x')}.mp4`)
      await makeClip({ shot, seconds, aspect, out, dir, mock, handle: payload.personaHandle })
      clips.push(out)
    }
    const render = path.join(dir, `render-${aspect.replace(':', 'x')}.mp4`)
    await joinWithVoice({ clips, voice: voice.file, out: render, listFile: path.join(dir, `clips-${aspect.replace(':', 'x')}.txt`) })
    const storageId = await backend.upload(render, 'video/mp4')
    renders.push({ aspect, storageId, durationSec: Math.round(voice.seconds), mock })
  }
  const voiceStorageId = await backend.upload(voice.file, 'audio/mp4')
  return { renders, voiceStorageId }
}

async function makeClip(args: {
  shot: Shot
  seconds: number
  aspect: AspectRatio
  out: string
  dir: string
  mock: boolean
  handle: string
}): Promise<void> {
  if (args.shot.kind === 'screen' && !args.mock) {
    const webm = await recordScreen({ shot: args.shot, seconds: args.seconds, dir: path.join(args.dir, 'recordings'), headed: false })
    await fitClip({ input: webm, out: args.out, aspect: args.aspect })
    return
  }
  // Mock producer, avatar takes, and title cards: a card with the shot's title.
  const subtitle =
    args.shot.kind === 'avatar' ? `@${args.handle} (avatar take, mock)` : args.mock ? `@${args.handle} (mock render)` : `@${args.handle}`
  const { width, height } = SIZE[args.aspect]
  const image = await renderTitleCard({ title: args.shot.title, subtitle, out: args.out.replace(/\.mp4$/, '.png'), width, height })
  await stillClip({ image, out: args.out, aspect: args.aspect, seconds: args.seconds })
}
