import { AI_DISCLOSURE_LINE, sponsorDisclosureLine, type Platform, type SponsorSegment } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'

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
 * What a publication is written with, from the rows the rule reads: the
 * description text and the code it carries, so the page can show the code a
 * viewer sees rather than the code in force now. Production, the seed and a
 * code change that rewrites queued descriptions all go through here.
 */
export function describePublication(args: {
  workspace: Doc<'workspaces'>
  episode: Doc<'episodes'>
  platform: Platform
  linkSlug: string
  discountCode: Doc<'discountCodes'> | null
}): { description: string; discountCodeId: Id<'discountCodes'> | undefined } {
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
