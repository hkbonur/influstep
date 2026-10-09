import type { Platform } from '@influstep/shared'

export interface PlatformComment {
  externalId: string
  text: string
  likes: number
  at: number
}

export interface PlatformCounts {
  views: number
  likes: number
  comments: number
  follows: number
  watchRate: number
}

export interface PlatformProvider {
  readonly platform: Platform
  readonly name: string
  comments(externalId: string): Promise<PlatformComment[]>
  counts(args: { externalId: string; publishedAt: number }): Promise<PlatformCounts>
}
