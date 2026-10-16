import fs from 'node:fs/promises'
import type { DesignVoicePayload, DesignVoiceResult } from '@influstep/shared'
import { z } from 'zod'
import { ffmpeg } from './ffmpeg'
import { providersMode, requireEnv } from './config'

/** Words per second a calm narrator manages; sets the mock track length and the shot timing. */
const WORDS_PER_SECOND = 2.4

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

const designResponseSchema = z.object({ previews: z.array(z.object({ generated_voice_id: z.string() })).min(1) })
const createResponseSchema = z.object({ voice_id: z.string().min(1) })

/** A mock voice id named after the persona, so a seeded or test run reads the same id twice. */
export function mockVoiceId(personaName: string): string {
  const slug = personaName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `mock-voice-${slug || 'persona'}`
}

/**
 * A spoken voice made from the operator's description (docs/plan.md, slice
 * 13). Mock: an id named after the persona; the mock voice track is silent
 * anyway. Real: ElevenLabs Voice Design makes previews from the description,
 * and the first preview is saved as a voice of the account under the
 * persona's name.
 */
export async function designVoice(payload: DesignVoicePayload): Promise<DesignVoiceResult> {
  if (providersMode() === 'mock') return { voiceId: mockVoiceId(payload.personaName), mock: true }
  const apiKey = requireEnv('ELEVENLABS_API_KEY')
  const headers = { 'xi-api-key': apiKey, 'Content-Type': 'application/json' }
  const designed = await fetch('https://api.elevenlabs.io/v1/text-to-voice/design', {
    method: 'POST',
    headers,
    body: JSON.stringify({ voice_description: payload.description, auto_generate_text: true }),
  })
  if (!designed.ok) throw new Error(`ElevenLabs refused the voice design: ${designed.status} ${await designed.text()}`)
  const [preview] = designResponseSchema.parse(await designed.json()).previews
  if (!preview) throw new Error('ElevenLabs returned no voice preview')
  const created = await fetch('https://api.elevenlabs.io/v1/text-to-voice', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      voice_name: payload.personaName,
      voice_description: payload.description,
      generated_voice_id: preview.generated_voice_id,
    }),
  })
  if (!created.ok) throw new Error(`ElevenLabs refused to save the voice: ${created.status} ${await created.text()}`)
  return { voiceId: createResponseSchema.parse(await created.json()).voice_id, mock: false }
}
