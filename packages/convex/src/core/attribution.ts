import { AI_DISCLOSURE_LINE, sponsorDisclosureLine, type Platform, type SponsorSegment } from '@influstep/shared'

/**
 * The description every publication carries: disclosure first (platform and
 * law both want it in the first line), then the script's summary, then the
 * tracked link.
 */
export function buildDescription(args: {
  concept: string
  sponsorSegment: SponsorSegment
  sponsorName: string
  trackedUrl: string
  platform: Platform
}): string {
  const lines = [AI_DISCLOSURE_LINE]
  if (args.sponsorSegment !== 'none') lines.push(sponsorDisclosureLine(args.sponsorName))
  lines.push('', args.concept, '')
  if (args.platform === 'youtube') lines.push(`${args.sponsorName}: ${args.trackedUrl}`)
  else lines.push(`Link in bio.`)
  return lines.join('\n')
}
