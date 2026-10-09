import type { Platform } from '@influstep/shared'
import { providersMode } from '../../lib/env'
import { mockPlatform } from './mock'
import type { PlatformProvider } from './types'
import { youtubePlatform } from './youtube'

const REAL: Partial<Record<Platform, PlatformProvider>> = { youtube: youtubePlatform }

export function platformProvider(platform: Platform): PlatformProvider {
  if (providersMode() === 'mock') return mockPlatform(platform)
  const real = REAL[platform]
  if (!real) throw new Error(`No real read adapter for ${platform} yet (needs the platform's OAuth app)`)
  return real
}

export function platformHasRealAdapter(platform: Platform): boolean {
  return platform in REAL
}
