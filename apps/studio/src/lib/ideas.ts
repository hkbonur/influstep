import { isPost, scriptDayOf, type EpisodeKind } from '@influstep/shared'
import { formatDay } from './format'

/**
 * What an idea says where a written episode shows its first line (CONTEXT.md,
 * Just-in-time script): that the writer is on it now, or the day it will be,
 * the day before the episode goes out (shared scriptDayOf). A video's words are
 * its script; a post has no script, so its line says when it is written.
 */
export function ideaLine(episode: { kind: EpisodeKind; plannedFor: string }, writing: boolean): string {
  if (writing) return 'Writing now'
  const day = formatDay(scriptDayOf(episode.plannedFor), { weekday: 'short', day: 'numeric', month: 'short' })
  if (isPost(episode.kind)) return `Writing on ${day}`
  return `Script on ${day}`
}

/** The rule in the persona's words, said once on the episode page while the episode is still an idea. */
export function ideaExplanation(kind: EpisodeKind): string {
  const words = isPost(kind) ? 'the post' : 'the script'
  return `I write ${words} the day before it goes out, after a last look at what moved that morning.`
}
