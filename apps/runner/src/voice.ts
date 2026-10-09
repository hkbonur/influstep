import fs from 'node:fs/promises'
import { ffmpeg } from './ffmpeg'
import { providersMode, requireEnv } from './config'

/** Words per second a calm narrator manages; sets the mock track length and the shot timing. */
export const WORDS_PER_SECOND = 2.4

export function spokenSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(2, words / WORDS_PER_SECOND)
}

export interface VoiceTrack {
  file: string
  seconds: number
  mock: boolean
}

/**
 * The persona's voice. Mock: a silent track the length the words would take,
 * so the cut has the right timing. Real: ElevenLabs text-to-speech with the
 * persona's voice id (commercial use needs a paid plan).
 */
export async function makeVoice(args: { text: string; voiceId: string; out: string }): Promise<VoiceTrack> {
  const seconds = spokenSeconds(args.text)
  if (providersMode() === 'mock') {
    await ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`, '-t', String(seconds.toFixed(2)), '-c:a', 'aac', args.out])
    return { file: args.out, seconds, mock: true }
  }
  const apiKey = requireEnv('ELEVENLABS_API_KEY')
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(args.voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: args.text, model_id: 'eleven_multilingual_v2' }),
    }
  )
  if (!response.ok) throw new Error(`ElevenLabs refused: ${response.status} ${await response.text()}`)
  await fs.writeFile(args.out, Buffer.from(await response.arrayBuffer()))
  const { durationOf } = await import('./ffmpeg')
  return { file: args.out, seconds: await durationOf(args.out), mock: false }
}
