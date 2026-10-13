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
