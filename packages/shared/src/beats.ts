import type { SponsorSegment } from './episode-status'
import type { MediaKind } from './media'

/**
 * A video's script (docs/plan.md, slice 6): its beats. Each beat is what is
 * spoken over it and what is shown while it is spoken. The voice track is
 * built from the shots and the shots from the beats, so the beats are the
 * only script: the writer writes them, the operator edits them, and the
 * spoken script and the hook are derived from them here.
 */
export interface Beat {
  /** A short name for the beat, shown in the editor and on its shot. */
  title: string
  /** Exactly what the voice says over this beat. */
  voiceover: string
  /** The tool the screen shows, or the presenter speaking to camera (no screen, no URL). */
  tool: string
  url: string
  /**
   * An image or a clip of the persona's asset library the beat shows in place
   * of the tool's screen or the presenter (shared `PLACEABLE_ASSET_KINDS`).
   * The writer places it by name; the producer shows it for the beat's length.
   */
  assetId?: string
  /**
   * A picture the producer generates for the beat (shared media.ts), asked for
   * where the writer would otherwise name an asset. Once it is made, the beat
   * shows it as its asset; `generationId` is the generation that makes it.
   */
  generate?: { kind: MediaKind; prompt: string; generationId?: string }
}

/** The spoken pace a script's length is measured at. */
export const WORDS_PER_SECOND = 2.4

/** The script as it is spoken: every beat's voiceover in order, a blank line between beats. */
export function spokenScript(beats: readonly Pick<Beat, 'voiceover'>[]): string {
  return beats.map((beat) => beat.voiceover).join('\n\n')
}

/** Every spoken word of the script, counted the way its length is judged. */
export function spokenWordCount(beats: readonly Pick<Beat, 'voiceover'>[]): number {
  return beats.reduce((count, beat) => count + wordCount(beat.voiceover), 0)
}

/** About how long the script takes to say, in whole seconds, at WORDS_PER_SECOND. */
export function spokenSeconds(beats: readonly Pick<Beat, 'voiceover'>[]): number {
  return Math.round(spokenWordCount(beats) / WORDS_PER_SECOND)
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

/** A sentence ends at a run of end marks, closing quotes or brackets after them, then a space or the end. */
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s|$)/

/**
 * The first sentence of a text, its end mark included. A line break ends it
 * too, and a text without an end mark is one sentence.
 */
export function firstSentence(text: string): string {
  const trimmed = text.trim()
  const newline = trimmed.indexOf('\n')
  const line = newline === -1 ? trimmed : trimmed.slice(0, newline)
  const end = SENTENCE_END.exec(line)
  if (!end) return line.trim()
  return line.slice(0, end.index + end[0].length).trim()
}

/**
 * A video's hook (the experiments' unit): the first sentence of the first
 * beat. The writer and the operator's beat editor both store it through
 * here, so the hook is always what the recording opens with. Empty while
 * there is no beat, as on an idea.
 */
export function hookOf(beats: readonly Pick<Beat, 'voiceover'>[]): string {
  const [first] = beats
  if (!first) return ''
  return firstSentence(first.voiceover)
}

/**
 * Everything that keeps the beats from being a script the episode can record,
 * in the order the operator fixes them. Empty when the script is ready. The
 * sponsor rule follows the segment: a video without a sponsor never names it,
 * a mention says its name in at least one beat, and a demo also shows it on
 * screen in a beat of its own. The writer retries on these and the beat
 * editor refuses with the first.
 */
export function scriptProblems(beats: readonly Beat[], sponsor: { sponsorSegment: SponsorSegment; sponsorName: string }): string[] {
  if (beats.length === 0) return ['A script needs at least one beat.']
  const problems: string[] = []
  for (const [index, beat] of beats.entries()) {
    const n = index + 1
    if (beat.title.trim().length === 0) problems.push(`Beat ${n} has no title.`)
    if (beat.voiceover.trim().length === 0) problems.push(`Beat ${n} has no spoken line.`)
  }
  const name = sponsor.sponsorName.toLowerCase()
  const naming = beats.flatMap((beat, index) => (beat.voiceover.toLowerCase().includes(name) ? [index + 1] : []))
  if (sponsor.sponsorSegment === 'none') {
    for (const n of naming) problems.push(`Beat ${n} names ${sponsor.sponsorName}, but this episode carries no sponsor.`)
    return problems
  }
  if (naming.length === 0) problems.push(`A sponsored episode says ${sponsor.sponsorName} in at least one beat.`)
  if (sponsor.sponsorSegment === 'demo' && !beats.some((beat) => beat.tool.toLowerCase() === name)) {
    problems.push(`A sponsor demo needs a beat that shows ${sponsor.sponsorName} on screen.`)
  }
  return problems
}

/** How far a script's spoken length may stray from its target: half to one and a half times. */
const LENGTH_TOLERANCE = 0.5

/**
 * Whether the spoken words fit the format's length, at WORDS_PER_SECOND,
 * within half to one and a half times the target. The writer retries on it;
 * the beat editor never refuses on it, since an operator may trim a script,
 * and shows the seconds estimate instead.
 */
export function lengthProblem(beats: readonly Pick<Beat, 'voiceover'>[], lengthSec: number): string | null {
  const words = spokenWordCount(beats)
  const target = Math.round(lengthSec * WORDS_PER_SECOND)
  const min = Math.round(target * (1 - LENGTH_TOLERANCE))
  const max = Math.round(target * (1 + LENGTH_TOLERANCE))
  if (words >= min && words <= max) return null
  return `The script is ${words} words; a ${lengthSec} s video takes ${min} to ${max} (about ${target}).`
}
