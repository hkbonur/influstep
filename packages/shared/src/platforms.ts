export const PLATFORMS = ['youtube', 'tiktok', 'instagram'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
}

export const ASPECT_RATIOS = ['16:9', '9:16'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

/** Which render each platform publishes. YouTube takes the wide cut; the rest take vertical. */
export const PLATFORM_ASPECT: Record<Platform, AspectRatio> = {
  youtube: '16:9',
  tiktok: '9:16',
  instagram: '9:16',
}

/** Every platform gets the same disclosure line, in the first line of the description. */
export const AI_DISCLOSURE_LINE = 'This video features an AI-generated presenter.'

export function sponsorDisclosureLine(sponsorName: string): string {
  return `Sponsored by ${sponsorName}.`
}
