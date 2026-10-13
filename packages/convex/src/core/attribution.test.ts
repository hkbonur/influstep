import { describe, expect, it } from 'vitest'
import { assertXTitleFits, buildDescription } from './attribution'

const base = { concept: 'Retry a failed webhook', sponsorName: 'Formstep', trackedUrl: 'http://localhost:3300/go/abc' } as const

describe('buildDescription', () => {
  it('names the sponsor and the tracked link even when the video has no sponsor segment', () => {
    const text = buildDescription({ ...base, sponsorSegment: 'none', platform: 'youtube' })
    expect(text).not.toContain('Sponsored by')
    expect(text).toContain('Formstep collects')
    expect(text).toContain(base.trackedUrl)
    expect(text.startsWith('This video features an AI-generated presenter.')).toBe(true)
  })

  it('adds the sponsorship disclosure when the video carries the sponsor', () => {
    expect(buildDescription({ ...base, sponsorSegment: 'mention', platform: 'youtube' })).toContain('Sponsored by Formstep.')
  })

  it('puts the discount code before the link and sends other platforms to the bio', () => {
    const text = buildDescription({
      ...base,
      sponsorSegment: 'none',
      platform: 'tiktok',
      discountCode: { code: 'ADA20', offer: '20% off for 3 months' },
    })
    expect(text).toContain('Code ADA20: 20% off for 3 months.')
    expect(text).toContain('Link in bio.')
    expect(text).not.toContain(base.trackedUrl)
    expect(text.indexOf('Code ADA20')).toBeLessThan(text.indexOf('Link in bio.'))
  })
})

describe('assertXTitleFits', () => {
  it('takes a title X takes and refuses a longer one', () => {
    expect(() => assertXTitleFits('a'.repeat(280))).not.toThrow()
    expect(() => assertXTitleFits('a'.repeat(281))).toThrow('The title is 281 characters; X allows 280.')
  })
})
