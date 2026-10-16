import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AspectRatio } from '@influstep/shared'

const execFileAsync = promisify(execFile)

export const SIZE: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
}

export async function ffmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : ''
    throw new Error(`ffmpeg failed: ${stderr || (error instanceof Error ? error.message : String(error))}`)
  }
}

export async function durationOf(file: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  const seconds = Number(stdout.trim())
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe could not read the duration of ${file}`)
  return seconds
}

/** Scales a picture into the aspect's frame and pads it on the paper background, at 30 fps: every clip of a render matches. */
function frameFilter(aspect: AspectRatio): string {
  const { width, height } = SIZE[aspect]
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0xfafafa,fps=30,format=yuv420p`
}

/** A still image held for `seconds`, at the aspect's frame size. */
export async function stillClip(args: { image: string; out: string; aspect: AspectRatio; seconds: number }): Promise<void> {
  await ffmpeg([
    '-loop',
    '1',
    '-i',
    args.image,
    '-t',
    args.seconds.toFixed(2),
    '-vf',
    frameFilter(args.aspect),
    '-c:v',
    'libx264',
    args.out,
  ])
}

/** Scale and pad any clip to the aspect's frame, 30 fps, no audio. */
export async function fitClip(args: { input: string; out: string; aspect: AspectRatio }): Promise<void> {
  await ffmpeg(['-i', args.input, '-vf', frameFilter(args.aspect), '-an', '-c:v', 'libx264', args.out])
}

/** A clip played from its start and looped until `seconds`, fitted to the aspect's frame, no audio: the voice track speaks over it. */
export async function loopedClip(args: { input: string; out: string; aspect: AspectRatio; seconds: number }): Promise<void> {
  await ffmpeg([
    '-stream_loop',
    '-1',
    '-i',
    args.input,
    '-t',
    args.seconds.toFixed(2),
    '-vf',
    frameFilter(args.aspect),
    '-an',
    '-c:v',
    'libx264',
    args.out,
  ])
}

/** Joins clips (same size and codec) and lays the voice track under them. */
export async function joinWithVoice(args: { clips: string[]; voice: string | null; out: string; listFile: string }): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(args.listFile, args.clips.map((clip) => `file '${clip.replace(/'/g, "'\\''")}'`).join('\n'))
  const inputs = ['-f', 'concat', '-safe', '0', '-i', args.listFile]
  if (args.voice) inputs.push('-i', args.voice)
  await ffmpeg([
    ...inputs,
    ...(args.voice ? ['-map', '0:v:0', '-map', '1:a:0', '-shortest', '-c:a', 'aac'] : ['-map', '0:v:0']),
    '-c:v',
    'copy',
    args.out,
  ])
}

/** One beat's stretch of the voice track, as a mono WAV an avatar provider takes. */
export async function audioSlice(args: { input: string; start: number; seconds: number; out: string }): Promise<void> {
  await ffmpeg(['-ss', args.start.toFixed(2), '-t', args.seconds.toFixed(2), '-i', args.input, '-ac', '1', '-ar', '44100', args.out])
}

/** The whole voice track as a mono WAV, for the one take a Loom-style video's bubble is cut from. */
export async function audioWav(args: { input: string; out: string }): Promise<void> {
  await ffmpeg(['-i', args.input, '-ac', '1', '-ar', '44100', args.out])
}

/**
 * A square avatar take fitted to the aspect's frame for `seconds` from
 * `start`: a vertical frame is filled (the face stays in the middle of a
 * square, so the crop takes only its sides), a wide one is boxed on the
 * paper background, so the face is never cut. Its last frame holds when the
 * take runs short of the beat. No audio: the voice track speaks over it.
 */
export async function takeClip(args: { input: string; start: number; seconds: number; aspect: AspectRatio; out: string }): Promise<void> {
  const { width, height } = SIZE[args.aspect]
  const fit =
    args.aspect === '9:16'
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,format=yuv420p`
      : frameFilter(args.aspect)
  await ffmpeg([
    '-ss',
    args.start.toFixed(2),
    '-i',
    args.input,
    '-t',
    args.seconds.toFixed(2),
    '-vf',
    `${fit},tpad=stop_mode=clone:stop_duration=${Math.ceil(args.seconds)}`,
    '-t',
    args.seconds.toFixed(2),
    '-an',
    '-c:v',
    'libx264',
    args.out,
  ])
}

/** Where a Loom-style bubble sits and how large it is, for a frame of the aspect: bottom left, a quarter of the short side. */
function bubbleGeometry(aspect: AspectRatio): { size: number; margin: number } {
  const short = Math.min(SIZE[aspect].width, SIZE[aspect].height)
  return { size: Math.round(short * 0.26), margin: Math.round(short * 0.045) }
}

/**
 * The presenter in a round bubble over a clip of the screen, the Loom way:
 * a stretch of the presenter's take from `start`, or a still held for a mock.
 */
export async function overlayBubble(args: {
  base: string
  bubble: { kind: 'video'; file: string; start: number } | { kind: 'image'; file: string }
  seconds: number
  aspect: AspectRatio
  out: string
}): Promise<void> {
  const { size, margin } = bubbleGeometry(args.aspect)
  const bubbleInput =
    args.bubble.kind === 'video'
      ? ['-ss', args.bubble.start.toFixed(2), '-t', args.seconds.toFixed(2), '-i', args.bubble.file]
      : ['-loop', '1', '-t', args.seconds.toFixed(2), '-i', args.bubble.file]
  const radius = size / 2
  const circle = `geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='if(lte(hypot(X-${radius},Y-${radius}),${radius - 2}),255,0)'`
  await ffmpeg([
    '-i',
    args.base,
    ...bubbleInput,
    '-filter_complex',
    `[1:v]scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size},format=yuva420p,${circle}[b];[0:v][b]overlay=${margin}:H-h-${margin}:eof_action=repeat,format=yuv420p`,
    '-t',
    args.seconds.toFixed(2),
    '-an',
    '-c:v',
    'libx264',
    args.out,
  ])
}
