import fs from 'node:fs/promises'
import path from 'node:path'
import {
  APPEARANCE_STYLE_LABELS,
  X_IMAGE_ASPECT,
  type AspectRatio,
  type PresenterFace,
  type ProduceAppearance,
  type ProducePayload,
  type ProduceResult,
  type Shot,
} from '@influstep/shared'
import { backend } from './backend'
import { artifactsDir, providersMode } from './config'
import { heygenTakes, shotStarts } from './avatar'
import { SIZE, audioSlice, audioWav, fitClip, joinWithVoice, loopedClip, overlayBubble, stillClip, takeClip } from './ffmpeg'
import { recordScreen, renderAvatarCard, renderImageFrame, renderPortraitSquare, renderTitleCard } from './record'
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
  const starts = shotStarts(payload.shots)
  const presenter = mock
    ? await mockPresenter(payload, portrait, dir)
    : await realPresenter({ payload, voice: voice.file, portrait, starts, dir })

  const renders: ProduceResult['renders'] = []
  for (const aspect of payload.aspects) {
    const clips: string[] = []
    for (const [index, shot] of payload.shots.entries()) {
      const seconds = spokenSeconds(shot.voiceover)
      const out = path.join(dir, `shot-${index + 1}-${aspect.replace(':', 'x')}.mp4`)
      const clip = { shot, index, start: starts[index] ?? 0, seconds, aspect, dir, mock, handle: payload.personaHandle, assets, presenter }
      // A Loom-style video keeps its presenter in a bubble over everything the screen shows.
      if (presenter.bubble === null || shot.kind === 'avatar') await makeClip({ ...clip, out })
      else {
        const base = out.replace(/\.mp4$/, '-base.mp4')
        await makeClip({ ...clip, out: base })
        await overlayBubble({ base, bubble: bubbleAt(presenter.bubble, clip.start), seconds, aspect, out })
      }
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

/**
 * How the presenter shows in this job. Mock: a card in the look for each
 * take, and the portrait as a still in a Loom-style bubble. Real: the avatar
 * provider's takes, one per presenter beat, or for a Loom-style video one
 * take over the whole voice track that every beat and the bubble are cut from.
 */
type Presenter =
  | { kind: 'mock'; look: string | null; face: PresenterFace | null; portrait: DownloadedAsset | null; bubble: string | null }
  | { kind: 'takes'; takes: Map<number, string>; whole: string | null; bubble: string | null }

function bubbleAt(bubble: string, start: number): { kind: 'video'; file: string; start: number } | { kind: 'image'; file: string } {
  return bubble.endsWith('.png') ? { kind: 'image', file: bubble } : { kind: 'video', file: bubble, start }
}

async function mockPresenter(payload: VideoPayload, portrait: DownloadedAsset | null, dir: string): Promise<Presenter> {
  const look = payload.appearance ? APPEARANCE_STYLE_LABELS[payload.appearance.style] : null
  const face = payload.appearance?.face ?? null
  const bubble =
    payload.appearance?.style === 'loom' ? await renderPortraitSquare({ face, portrait, out: path.join(dir, 'bubble.png') }) : null
  return { kind: 'mock', look, face, portrait, bubble }
}

/**
 * The real takes this video needs: none without a presenter beat or a
 * Loom-style bubble. A take is made from the look's portrait, so a video
 * that needs one and has none fails with what to do.
 */
async function realPresenter(args: {
  payload: VideoPayload
  voice: string
  portrait: DownloadedAsset | null
  starts: number[]
  dir: string
}): Promise<Presenter> {
  const { payload } = args
  const loom = payload.appearance?.style === 'loom'
  const avatarShots = payload.shots.flatMap((shot, index) => (shot.kind === 'avatar' ? [{ shot, index }] : []))
  if (!loom && avatarShots.length === 0) return { kind: 'takes', takes: new Map(), whole: null, bubble: null }
  if (args.portrait === null)
    throw new Error(
      `@${payload.personaHandle} has no portrait for its avatar takes: generate one on its Assets page, or upload a picture of the look.`
    )
  const takesDir = path.join(args.dir, 'takes')
  const heygen = await heygenTakes(args.portrait, takesDir)
  if (loom) {
    const wav = path.join(takesDir, 'voice.wav')
    await audioWav({ input: args.voice, out: wav })
    const whole = await heygen.take({
      audio: wav,
      out: path.join(takesDir, 'whole.mp4'),
      title: `@${payload.personaHandle} ${payload.episodeId}`,
    })
    return { kind: 'takes', takes: new Map(), whole, bubble: whole }
  }
  const takes = new Map<number, string>()
  for (const { shot, index } of avatarShots) {
    const wav = path.join(takesDir, `shot-${index + 1}.wav`)
    await audioSlice({ input: args.voice, start: args.starts[index] ?? 0, seconds: spokenSeconds(shot.voiceover), out: wav })
    takes.set(
      index,
      await heygen.take({ audio: wav, out: path.join(takesDir, `shot-${index + 1}.mp4`), title: `@${payload.personaHandle} ${shot.title}` })
    )
  }
  return { kind: 'takes', takes, whole: null, bubble: null }
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
  index: number
  /** Where the shot starts on the voice track. */
  start: number
  seconds: number
  aspect: AspectRatio
  out: string
  dir: string
  mock: boolean
  handle: string
  assets: Map<string, DownloadedAsset>
  presenter: Presenter
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
    const presenter = args.presenter
    if (presenter.kind === 'takes') {
      // A Loom-style video cuts every take from its one whole-track take; otherwise each beat has its own.
      const take = presenter.whole ?? presenter.takes.get(args.index)
      if (take === undefined) throw new Error(`shot ${args.shot.id} is an avatar take, but none was made for it`)
      await takeClip({
        input: take,
        start: presenter.whole === null ? 0 : args.start,
        seconds: args.seconds,
        aspect: args.aspect,
        out: args.out,
      })
      return
    }
    const look = presenter.look ?? 'look not set'
    const image = await renderAvatarCard({
      title: args.shot.title,
      subtitle: `@${args.handle} · ${look} · avatar take, mock`,
      face: presenter.face,
      portrait: presenter.portrait,
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
