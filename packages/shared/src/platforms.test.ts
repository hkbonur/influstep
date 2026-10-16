import { describe, expect, it } from 'vitest'
import { bioPath, isPlatform, trackedLinkPath } from './platforms'

describe('isPlatform', () => {
  it('knows the four platforms and nothing else', () => {
    expect(['youtube', 'tiktok', 'instagram', 'x'].every(isPlatform)).toBe(true)
    expect(isPlatform('bio')).toBe(false)
    expect(isPlatform('TikTok')).toBe(false)
  })
})

describe('bioPath', () => {
  it('names the platform the bio sits on, when there is one', () => {
    expect(bioPath('ada.automates')).toBe('/p/ada.automates')
    expect(bioPath('ada.automates', 'tiktok')).toBe('/p/ada.automates?via=tiktok')
  })
})

describe('trackedLinkPath', () => {
  it('carries the bio platform on to the click', () => {
    expect(trackedLinkPath('k3x9p2a')).toBe('/go/k3x9p2a')
    expect(trackedLinkPath('k3x9p2a', 'instagram')).toBe('/go/k3x9p2a?via=instagram')
  })
})
