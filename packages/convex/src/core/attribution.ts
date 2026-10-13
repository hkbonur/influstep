import { AI_DISCLOSURE_LINE, X_POST_LIMIT, sponsorDisclosureLine, xLength, type Platform, type SponsorSegment } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import { refusal } from '../lib/errors'

/**
 * The description every publication carries. The sponsor is in every
 * description whatever the video does with it: the disclosure lines first
 * (platform and law both want them at the top), the concept, then the
 * Formstep line with the discount code and the tracked link. The sponsor
 * segment only decides whether the video itself mentions or shows the
 * sponsor, so the "Sponsored by" line follows it; the link and code do not.
 */
export function buildDescription(args: {
  concept: string
  sponsorSegment: SponsorSegment
  sponsorName: string
  trackedUrl: string
  platform: Platform
  discountCode?: { code: string; offer: string }
}): string {
  const lines = [AI_DISCLOSURE_LINE]
  if (args.sponsorSegment !== 'none') lines.push(sponsorDisclosureLine(args.sponsorName))
  lines.push('', args.concept, '')
  lines.push(sponsorLine(args.sponsorName))
  if (args.discountCode) lines.push(`Code ${args.discountCode.code}: ${args.discountCode.offer}.`)
  if (args.platform === 'youtube') lines.push(args.trackedUrl)
  else lines.push('Link in bio.')
  return lines.join('\n')
}

/**
 * A video goes to X with its title as the post text and nothing appended
 * (docs/plan.md, slice 4): the account's automated label is the disclosure.
 * Approval checks the title fits, before anything renders.
 */
export function assertXTitleFits(title: string): void {
  const length = xLength(title)
  if (length > X_POST_LIMIT) throw refusal(`The title is ${length} characters; X allows ${X_POST_LIMIT}.`)
}

/**
 * What a publication is written with, from the rows the rule reads: the
 * description text and the code it carries, so the page can show the code a
 * viewer sees rather than the code in force now. Production, the seed and a
 * code change that rewrites queued descriptions all go through here. On X the
 * text is the title alone, so it carries no code.
 */
export function describePublication(args: {
  workspace: Doc<'workspaces'>
  episode: Doc<'episodes'>
  platform: Platform
  linkSlug: string
  discountCode: Doc<'discountCodes'> | null
}): { description: string; discountCodeId: Id<'discountCodes'> | undefined } {
  if (args.platform === 'x') {
    if (xLength(args.episode.title) > X_POST_LIMIT)
      throw new Error(`episode ${args.episode._id} reached X with a title over ${X_POST_LIMIT}`)
    return { description: args.episode.title, discountCodeId: undefined }
  }
  return {
    description: buildDescription({
      concept: args.episode.concept,
      sponsorSegment: args.episode.sponsorSegment,
      sponsorName: args.workspace.sponsorName,
      trackedUrl: `${args.workspace.appUrl}/go/${args.linkSlug}`,
      platform: args.platform,
      discountCode: args.discountCode ? { code: args.discountCode.code, offer: args.discountCode.offer } : undefined,
    }),
    discountCodeId: args.discountCode?._id,
  }
}

function sponsorLine(sponsorName: string): string {
  return `${sponsorName} collects what your workflow needs from a customer, one request at a time.`
}
