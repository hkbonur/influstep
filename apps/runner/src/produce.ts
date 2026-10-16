import fs from 'node:fs/promises'
import path from 'node:path'
import {
  APPEARANCE_STYLE_LABELS,
  X_IMAGE_ASPECT,
  type AspectRatio,
  type ProduceAppearance,
  type ProducePayload,
  type ProduceResult,
  type Shot,
} from '@influstep/shared'
import { backend } from './backend'
import { artifactsDir, providersMode } from './config'
import { SIZE, fitClip, joinWithVoice, loopedClip, stillClip } from './ffmpeg'
import { recordScreen, renderAvatarCard, renderImageFrame, renderTitleCard } from './record'
import { makeVoice, spokenSeconds } from './voice'

type VideoPayload = Extract<ProducePayload, { kind: 'video' }>
type ImagePayload = Extract<ProducePayload, { kind: 'image' }>

/**
 * The producer: one clip per shot (a screen recording in real mode, a title
 * card in mock mode, an asset of the library in both), the voice track, then
 * one render per aspect ratio, uploaded to Convex storage. An image post is
 * one title card and nothing else.
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
  const assets = await downloadAssets(payload.assets, path.join(dir, 'assets'))
  const portrait = await portraitOf(payload.appearance, path.join(dir, 'references'))

  const renders: ProduceResult['renders'] = []
  for (const aspect of payload.aspects) {
    const clips: string[] = []
    for (const [index, shot] of payload.shots.entries()) {
      const seconds = spokenSeconds(shot.voiceover)
      const out = path.join(dir, `shot-${index + 1}-${aspect.replace(':', 'x')}.mp4`)
      await makeClip({
        shot,
        seconds,
        aspect,
        out,
        dir,
        mock,
        handle: payload.personaHandle,
        assets,
        appearance: payload.appearance,
        portrait,
      })
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

/** An asset a shot shows, downloaded once per job: the file, the type storage served it as, and whether it is held or looped. */
interface DownloadedAsset {
  file: string
  contentType: string
  kind: VideoPayload['assets'][number]['kind']
}

async function downloadAssets(assets: VideoPayload['assets'], dir: string): Promise<Map<string, DownloadedAsset>> {
  const files = new Map<string, DownloadedAsset>()
  if (assets.length === 0) return files
  await fs.mkdir(dir, { recursive: true })
  for (const asset of assets) {
    const response = await fetch(asset.url)
    if (!response.ok) throw new Error(`asset ${asset.assetId} did not download: ${response.status} ${await response.text()}`)
    const contentType = response.headers.get('content-type')
    if (contentType === null) throw new Error(`asset ${asset.assetId} came without a content type`)
    const file = path.join(dir, asset.assetId)
    await fs.writeFile(file, Buffer.from(await response.arrayBuffer()))
    files.set(asset.assetId, { file, contentType, kind: asset.kind })
  }
  return files
}

/** The first reference image of the look, downloaded for the avatar take's portrait; none without one. */
async function portraitOf(appearance: ProduceAppearance, dir: string): Promise<DownloadedAsset | null> {
  const first = appearance?.references.find((reference) => reference.kind === 'image')
  if (!first) return null
  const downloaded = await downloadAssets([first], dir)
  const portrait = downloaded.get(first.assetId)
  if (!portrait) throw new Error(`reference ${first.assetId} did not download`)
  return portrait
}

async function makeClip(args: {
  shot: Shot
  seconds: number
  aspect: AspectRatio
  out: string
  dir: string
  mock: boolean
  handle: string
  assets: Map<string, DownloadedAsset>
  appearance: ProduceAppearance
  portrait: DownloadedAsset | null
}): Promise<void> {
  // An asset is a file the operator or the producer already made: it shows the same in both modes.
  if (args.shot.kind === 'asset') {
    const asset = args.assets.get(args.shot.assetId)
    if (!asset) throw new Error(`the job carries no file for asset ${args.shot.assetId}, which shot ${args.shot.id} shows`)
    if (asset.kind === 'clip') {
      await loopedClip({ input: asset.file, out: args.out, aspect: args.aspect, seconds: args.seconds })
      return
    }
    const { width, height } = SIZE[args.aspect]
    const image = await renderImageFrame({
      image: asset.file,
      contentType: asset.contentType,
      out: args.out.replace(/\.mp4$/, '.png'),
      width,
      height,
    })
    await stillClip({ image, out: args.out, aspect: args.aspect, seconds: args.seconds })
    return
  }
  if (args.shot.kind === 'screen' && !args.mock) {
    const webm = await recordScreen({ shot: args.shot, seconds: args.seconds, dir: path.join(args.dir, 'recordings'), headed: false })
    await fitClip({ input: webm, out: args.out, aspect: args.aspect })
    return
  }
  const { width, height } = SIZE[args.aspect]
  // An avatar take reads the look; no avatar provider exists yet, so in both modes it is a card that says so.
  if (args.shot.kind === 'avatar') {
    const look = args.appearance ? APPEARANCE_STYLE_LABELS[args.appearance.style] : 'look not set'
    const image = await renderAvatarCard({
      title: args.shot.title,
      subtitle: `@${args.handle} · ${look} · ${args.mock ? 'avatar take, mock' : 'avatar take, no avatar provider yet'}`,
      style: args.appearance?.style ?? null,
      portrait: args.portrait,
      out: args.out.replace(/\.mp4$/, '.png'),
      width,
      height,
    })
    await stillClip({ image, out: args.out, aspect: args.aspect, seconds: args.seconds })
    return
  }
  // Mock producer and title cards: a card with the shot's title.
  const subtitle = args.mock ? `@${args.handle} (mock render)` : `@${args.handle}`
  const image = await renderTitleCard({ title: args.shot.title, subtitle, out: args.out.replace(/\.mp4$/, '.png'), width, height })
  await stillClip({ image, out: args.out, aspect: args.aspect, seconds: args.seconds })
}
