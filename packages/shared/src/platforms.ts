export const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'x'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  x: 'X',
}

export function isPlatform(value: string): value is Platform {
  return PLATFORMS.some((platform) => platform === value)
}

/**
 * The link in bio's path (CONTEXT.md, "Link in bio"). Each platform's bio
 * points at the page with its own `via`, so a click on the sponsor link
 * there counts for that platform in the report.
 */
export function bioPath(handle: string, via?: Platform): string {
  return via === undefined ? `/p/${handle}` : `/p/${handle}?via=${via}`
}

/** A tracked link's path. The bio page's sponsor link carries the platform it was opened from on to the click. */
export function trackedLinkPath(slug: string, via?: Platform): string {
  return via === undefined ? `/go/${slug}` : `/go/${slug}?via=${via}`
}

export const ASPECT_RATIOS = ['16:9', '9:16'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

/** Which render each platform publishes. YouTube and X take the wide cut; the rest take vertical. */
export const PLATFORM_ASPECT: Record<Platform, AspectRatio> = {
  youtube: '16:9',
  tiktok: '9:16',
  instagram: '9:16',
  x: '16:9',
}

/** Every platform gets the same disclosure line, in the first line of the description. */
export const AI_DISCLOSURE_LINE = 'This video features an AI-generated presenter.'

export function sponsorDisclosureLine(sponsorName: string): string {
  return `Sponsored by ${sponsorName}.`
}
