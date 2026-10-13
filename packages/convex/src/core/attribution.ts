import {
  AI_DISCLOSURE_LINE,
  X_POST_LIMIT,
  effectiveVariant,
  sponsorDisclosureLine,
  xLength,
  type Platform,
  type SponsorSegment,
  type StrategyDefault,
  type StyledEpisode,
} from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import { refusal } from '../lib/errors'

/**
 * The description every video publication off X carries. The sponsor is in
 * every description whatever the video does with it: the disclosure lines
 * first (platform and law both want them at the top), the persona's own text,
 * then the Formstep line with the discount code and the tracked link. The
 * sponsor segment only decides whether the video itself mentions or shows the
 * sponsor, so the "Sponsored by" line follows it; the link and code do not.
 * The operator edits only the persona's text; the footer around it is
 * composed when the publication goes out, so an edit is never overwritten and
 * a code change reaches every publication not yet sent. The description
 * format (an experiment dimension) decides whether the code or the link comes
 * first under the text.
 */

/** Which of the code and the link leads under the text: the catalog's description format keys. */
export const DESCRIPTION_FORMATS = ['link', 'code'] as const
export type DescriptionFormat = (typeof DESCRIPTION_FORMATS)[number]

export function isDescriptionFormat(key: string): key is DescriptionFormat {
  return DESCRIPTION_FORMATS.some((format) => format === key)
}

/**
 * The description format an episode goes out with: shared `effectiveVariant`
 * on 'description_format', so the package preview and dispatch read the same
 * rule. A key outside the catalog is refused when the experiment starts, so
 * one here is a bug.
 */
export function descriptionFormatOf(episode: StyledEpisode, defaults: readonly StrategyDefault[] | undefined): DescriptionFormat {
  const key = effectiveVariant('description_format', episode, defaults).key
  if (!isDescriptionFormat(key)) throw new Error(`description format "${key}" is not one the footer knows`)
  return key
}

/** What dispatch adds around the persona's text: `above` it the disclosure lines, `below` it the sponsor line, the code and the link. */
export interface DescriptionFooter {
  above: string[]
  below: string[]
}

interface FooterArgs {
  sponsorSegment: SponsorSegment
  sponsorName: string
  trackedUrl: string
  /** X takes the title alone and never a footer. */
  platform: Exclude<Platform, 'x'>
  discountCode?: { code: string; offer: string }
  descriptionFormat: DescriptionFormat
}

/**
 * The lines around the persona's text. The disclosures stay first under
 * either format, as the platforms and the EU and FTC rules expect; the format
 * only orders the code and the link, so without a code the two read the same.
 */
export function descriptionFooter(args: FooterArgs): DescriptionFooter {
  const above = [AI_DISCLOSURE_LINE]
  if (args.sponsorSegment !== 'none') above.push(sponsorDisclosureLine(args.sponsorName))
  // Only YouTube prints a link that can be clicked; everywhere else the link lives in the bio.
  const link = args.platform === 'youtube' ? args.trackedUrl : 'Link in bio.'
  if (!args.discountCode) return { above, below: [sponsorLine(args.sponsorName), link] }
  const code = `Code ${args.discountCode.code}: ${args.discountCode.offer}.`
  const below = [sponsorLine(args.sponsorName), ...(args.descriptionFormat === 'code' ? [code, link] : [link, code])]
  return { above, below }
}

/** The lines above, a blank line, the persona's text, a blank line, the lines below. An empty text leaves one blank line. */
export function buildDescription(args: FooterArgs & { body: string }): string {
  const footer = descriptionFooter(args)
  const body = args.body.trim()
  const middle = body.length === 0 ? [''] : ['', body, '']
  return [...footer.above, ...middle, ...footer.below].join('\n')
}

/**
 * A video goes to X with its title as the post text and nothing appended
 * (docs/plan.md, slice 4): the account's automated label is the disclosure.
 * Approval, the beat editor and the package editor check the title fits.
 */
export function assertXTitleFits(title: string): void {
  const length = xLength(title)
  if (length > X_POST_LIMIT) throw refusal(`The title is ${length} characters; X allows ${X_POST_LIMIT}.`)
}

/** The rows one publication's text is composed from. `discountCode` is the code in force, or the one it went out with. */
export interface PublicationTextArgs {
  workspace: Pick<Doc<'workspaces'>, 'sponsorName' | 'appUrl'>
  episode: Pick<Doc<'episodes'>, 'sponsorSegment'>
  publication: Pick<Doc<'publications'>, '_id' | 'platform' | 'title' | 'body'>
  linkSlug: string
  discountCode: Pick<Doc<'discountCodes'>, 'code' | 'offer'> | null
  /** The episode's, from `descriptionFormatOf`. */
  descriptionFormat: DescriptionFormat
}

/**
 * What dispatch adds around a publication's body, or null on X, where
 * nothing is appended. The episode page previews the package through here
 * and dispatch composes through here, so the two cannot drift apart.
 */
export function publicationFooter(args: PublicationTextArgs): DescriptionFooter | null {
  const platform = args.publication.platform
  if (platform === 'x') return null
  return descriptionFooter(footerArgsOf(args, platform))
}

/**
 * The full text a platform receives for a video publication: on X its title
 * alone, elsewhere its body inside the footer (shared order: above, a blank
 * line, the body, a blank line, below). Dispatch checks the title and the
 * body first, so a throw here is a broken invariant.
 */
export function composeDescription(args: PublicationTextArgs): string {
  const { publication } = args
  const platform = publication.platform
  if (platform === 'x') {
    if (xLength(publication.title) > X_POST_LIMIT)
      throw new Error(`publication ${publication._id} reached X with a title over ${X_POST_LIMIT}`)
    return publication.title
  }
  if (publication.body === undefined) throw new Error(`publication ${publication._id} on ${platform} has no body`)
  return buildDescription({ ...footerArgsOf(args, platform), body: publication.body })
}

function footerArgsOf(args: PublicationTextArgs, platform: Exclude<Platform, 'x'>): FooterArgs {
  return {
    sponsorSegment: args.episode.sponsorSegment,
    sponsorName: args.workspace.sponsorName,
    trackedUrl: `${args.workspace.appUrl}/go/${args.linkSlug}`,
    platform,
    discountCode: args.discountCode ? { code: args.discountCode.code, offer: args.discountCode.offer } : undefined,
    descriptionFormat: args.descriptionFormat,
  }
}

function sponsorLine(sponsorName: string): string {
  return `${sponsorName} collects what your workflow needs from a customer, one request at a time.`
}
