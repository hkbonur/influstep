import type { Platform } from './platforms'

/**
 * What an episode is (docs/plan.md, slice 4): a video, or a post that goes
 * only to X and never records a screen or a voice. A text post and a thread
 * are words only; an image post carries one title card the producer renders.
 */

export const POST_KINDS = ['text', 'image', 'thread'] as const
export type PostKind = (typeof POST_KINDS)[number]

export const EPISODE_KINDS = ['video', ...POST_KINDS] as const
export type EpisodeKind = (typeof EPISODE_KINDS)[number]

export const EPISODE_KIND_LABELS: Record<EpisodeKind, string> = {
  video: 'Video',
  text: 'Text post',
  image: 'Image post',
  thread: 'Thread',
}

export function isPost(kind: EpisodeKind): kind is PostKind {
  return kind !== 'video'
}

/**
 * Whether a discount code reaches this episode: only a video's description
 * carries one, and nothing is appended on X, so a video needs a platform
 * besides X.
 */
export function carriesCode(episode: { kind: EpisodeKind; platforms: readonly Platform[] }): boolean {
  return !isPost(episode.kind) && episode.platforms.some((platform) => platform !== 'x')
}
