import { describe, expect, it } from 'vitest'
import { DEFAULT_FORMATS, formatAspects, formatLength, resolveEpisodeFormat, type PlatformFormat } from './formats'

const youtube: PlatformFormat = { platform: 'youtube', ...DEFAULT_FORMATS.youtube }
const tiktok: PlatformFormat = { platform: 'tiktok', ...DEFAULT_FORMATS.tiktok }
const instagram: PlatformFormat = { platform: 'instagram', ...DEFAULT_FORMATS.instagram }
const x: PlatformFormat = { platform: 'x', ...DEFAULT_FORMATS.x }

describe('resolveEpisodeFormat', () => {
  it('throws on an empty list', () => {
    expect(() => resolveEpisodeFormat([])).toThrow('at least one platform')
  })
  it('takes the shortest length and the delivery of the longest-form platform', () => {
    expect(resolveEpisodeFormat([tiktok, youtube, instagram])).toEqual({
      lengthSec: 35,
      delivery: 'screen_with_avatar',
      cuts: [
        { platform: 'youtube', aspect: '16:9' },
        { platform: 'tiktok', aspect: '9:16' },
        { platform: 'instagram', aspect: '9:16' },
      ],
    })
  })
  it('gives X the wide cut, after the video platforms', () => {
    expect(resolveEpisodeFormat([x, tiktok])).toEqual({
      lengthSec: 35,
      delivery: 'talking_head',
      cuts: [
        { platform: 'tiktok', aspect: '9:16' },
        { platform: 'x', aspect: '16:9' },
      ],
    })
  })
  it('keeps a single platform as it is', () => {
    expect(resolveEpisodeFormat([tiktok])).toEqual({
      lengthSec: 35,
      delivery: 'talking_head',
      cuts: [{ platform: 'tiktok', aspect: '9:16' }],
    })
  })
  it('breaks a length tie by PLATFORMS order and lists cuts in that order', () => {
    const wideInstagram: PlatformFormat = { ...instagram, lengthSec: 45, aspect: '16:9', delivery: 'screen_only' }
    const longTiktok: PlatformFormat = { ...tiktok, lengthSec: 45, delivery: 'talking_head' }
    expect(resolveEpisodeFormat([wideInstagram, longTiktok])).toEqual({
      lengthSec: 45,
      delivery: 'talking_head',
      cuts: [
        { platform: 'tiktok', aspect: '9:16' },
        { platform: 'instagram', aspect: '16:9' },
      ],
    })
  })
})

describe('formatAspects', () => {
  it('renders each aspect once, in cuts order', () => {
    expect(formatAspects(resolveEpisodeFormat([instagram, tiktok, youtube]))).toEqual(['16:9', '9:16'])
    expect(formatAspects(resolveEpisodeFormat([tiktok, instagram]))).toEqual(['9:16'])
  })
})

describe('formatLength', () => {
  it('says seconds under a minute and a half', () => {
    expect(formatLength(35)).toBe('35 s')
    expect(formatLength(89)).toBe('89 s')
  })
  it('says whole minutes without a decimal and others with one', () => {
    expect(formatLength(90)).toBe('1.5 min')
    expect(formatLength(240)).toBe('4 min')
    expect(formatLength(270)).toBe('4.5 min')
    expect(formatLength(100)).toBe('1.7 min')
  })
})
