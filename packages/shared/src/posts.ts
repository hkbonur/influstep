import type { PostKind } from './episode-kinds'
import type { PlatformFormat } from './formats'
import type { AspectRatio } from './platforms'

/**
 * Posts on X (docs/plan.md, slice 4): how X counts a post, when a day's posts
 * go out, and what makes a post one X accepts. A post is exactly the parts
 * the writer wrote, with no footer: the automated account label on the X
 * account is the disclosure. The writer, the operator's editor and the
 * publication all check through here, so they agree on every limit.
 */

/** The text a post is written as, and exactly what X receives. */
export interface EpisodePost {
  /** One part for a text or an image post, THREAD_PARTS_MIN to THREAD_PARTS_MAX for a thread. */
  parts: string[]
  /** The words on an image post's title card. */
  cardTitle?: string
}

export const X_POST_LIMIT = 280
export const THREAD_PARTS_MIN = 2
export const THREAD_PARTS_MAX = 6
export const CARD_TITLE_MAX = 60
export const X_IMAGE_ASPECT: AspectRatio = '16:9'

/** X shortens every link to a t.co URL of this many characters, whatever the link's own length. */
const X_URL_WEIGHT = 23
const URL_PATTERN = /https?:\/\/\S+/g

/**
 * A post's length the way X counts it: every link weighs 23, everything else
 * one per code point. X also weighs some scripts (CJK, for one) double;
 * personas write English, so that rule is left out.
 */
export function xLength(text: string): number {
  let length = 0
  let from = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    length += Array.from(text.slice(from, match.index)).length + X_URL_WEIGHT
    from = match.index + match[0].length
  }
  return length + Array.from(text.slice(from)).length
}

/**
 * The local hours a day's posts go out: three hours apart from the X format's
 * publish hour. A late publish hour slides the whole day earlier so the last
 * post still lands before midnight.
 */
export function postSlotHours(format: PlatformFormat): number[] {
  if (!format.cadence) throw new Error(`the ${format.platform} format has no post cadence`)
  const hours = Array.from({ length: format.cadence.postsPerDay }, (_, index) => format.publishHour + 3 * index)
  const last = hours.at(-1)
  if (last === undefined) return []
  const excess = Math.max(0, last - 23)
  return hours.map((hour) => Math.max(0, hour - excess))
}

/** A post's hook (the experiments' unit): the first line of its first part. Writer and editor both store it through here. */
export function postHook(parts: string[]): string {
  const [first] = parts
  if (first === undefined) return ''
  const text = first.trimStart()
  const end = text.indexOf('\n')
  return (end === -1 ? text : text.slice(0, end)).trim()
}

/**
 * Everything that keeps X from taking the post, in the order the operator
 * fixes them: the number of parts, each part, then the card. Empty when the
 * post is ready. Every part, the last included, has X's whole limit.
 */
export function postProblems(kind: PostKind, post: EpisodePost): string[] {
  const problems: string[] = []
  const count = post.parts.length
  if (kind === 'text' && count !== 1) problems.push('A text post is one part.')
  if (kind === 'image' && count !== 1) problems.push('An image post is one part.')
  if (kind === 'thread' && (count < THREAD_PARTS_MIN || count > THREAD_PARTS_MAX)) {
    problems.push(`A thread is ${THREAD_PARTS_MIN} to ${THREAD_PARTS_MAX} parts.`)
  }
  for (const [index, part] of post.parts.entries()) {
    const n = index + 1
    if (part.trim().length === 0) {
      problems.push(`Part ${n} is empty.`)
      continue
    }
    const length = xLength(part)
    if (length > X_POST_LIMIT) problems.push(`Part ${n} is ${length} characters; X allows ${X_POST_LIMIT}.`)
  }
  if (kind === 'image') {
    const cardProblem = cardTitleProblem(post.cardTitle)
    if (cardProblem) problems.push(cardProblem)
  }
  return problems
}

function cardTitleProblem(cardTitle: string | undefined): string | null {
  if (cardTitle === undefined || cardTitle.trim().length === 0) return 'An image post needs a card title.'
  const length = Array.from(cardTitle).length
  if (length > CARD_TITLE_MAX) return `The card title is ${length} characters; the card fits ${CARD_TITLE_MAX}.`
  return null
}
