import { AI_DISCLOSURE_LINE, X_POST_LIMIT, sponsorDisclosureLine, xLength, type Platform, type SponsorSegment } from '@influstep/shared'
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
 * a code change reaches every publication not yet sent.
 */

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
}

export function descriptionFooter(args: FooterArgs): DescriptionFooter {
  const above = [AI_DISCLOSURE_LINE]
  if (args.sponsorSegment !== 'none') above.push(sponsorDisclosureLine(args.sponsorName))
  const below = [sponsorLine(args.sponsorName)]
  if (args.discountCode) below.push(`Code ${args.discountCode.code}: ${args.discountCode.offer}.`)
  // Only YouTube prints a link that can be clicked; everywhere else the link lives in the bio.
  below.push(args.platform === 'youtube' ? args.trackedUrl : 'Link in bio.')
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
  }
}

function sponsorLine(sponsorName: string): string {
  return `${sponsorName} collects what your workflow needs from a customer, one request at a time.`
}
