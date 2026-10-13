import { describe, expect, it } from 'vitest'
import type { Id } from '../_generated/dataModel'
import { assertXTitleFits, buildDescription, composeDescription, publicationFooter, type PublicationTextArgs } from './attribution'

const base = {
  body: 'Retry a failed webhook without losing the payload.',
  sponsorName: 'Formstep',
  trackedUrl: 'http://localhost:3300/go/abc',
} as const
const code = { code: 'ADA20', offer: '20% off for 3 months' }

describe('buildDescription', () => {
  it('names the sponsor and the tracked link even when the video has no sponsor segment', () => {
    expect(buildDescription({ ...base, sponsorSegment: 'none', platform: 'youtube' })).toBe(
      [
        'This video features an AI-generated presenter.',
        '',
        base.body,
        '',
        'Formstep collects what your workflow needs from a customer, one request at a time.',
        base.trackedUrl,
      ].join('\n')
    )
  })

  it('adds the sponsorship disclosure under the AI one when the video carries the sponsor', () => {
    const text = buildDescription({ ...base, sponsorSegment: 'mention', platform: 'youtube' })
    expect(text.split('\n').slice(0, 3)).toEqual(['This video features an AI-generated presenter.', 'Sponsored by Formstep.', ''])
  })

  it('puts the code before the link on YouTube', () => {
    const lines = buildDescription({ ...base, sponsorSegment: 'none', platform: 'youtube', discountCode: code }).split('\n')
    expect(lines.slice(-2)).toEqual(['Code ADA20: 20% off for 3 months.', base.trackedUrl])
  })

  it('sends TikTok to the bio, with the code when one is in force and without it otherwise', () => {
    const withCode = buildDescription({ ...base, sponsorSegment: 'none', platform: 'tiktok', discountCode: code })
    expect(withCode.split('\n').slice(-2)).toEqual(['Code ADA20: 20% off for 3 months.', 'Link in bio.'])
    expect(withCode).not.toContain(base.trackedUrl)
    const without = buildDescription({ ...base, sponsorSegment: 'none', platform: 'tiktok' })
    expect(without).not.toContain('Code ')
    expect(without.split('\n').at(-1)).toBe('Link in bio.')
  })

  it('leaves one blank line between the disclosure and the sponsor line when the body is empty', () => {
    expect(buildDescription({ ...base, body: '  ', sponsorSegment: 'none', platform: 'instagram' }).split('\n')).toEqual([
      'This video features an AI-generated presenter.',
      '',
      'Formstep collects what your workflow needs from a customer, one request at a time.',
      'Link in bio.',
    ])
  })
})

describe('composeDescription', () => {
  const args = (platform: 'youtube' | 'tiktok' | 'x', body: string | undefined, discountCode: typeof code | null): PublicationTextArgs => ({
    workspace: { sponsorName: 'Formstep', appUrl: 'http://localhost:3300' },
    episode: { sponsorSegment: 'mention' },
    publication: { _id: 'publication' as Id<'publications'>, platform, title: 'Retries and money', body },
    linkSlug: 'abc',
    discountCode,
  })

  it('wraps the body in the footer the episode page previews', () => {
    const youtube = args('youtube', base.body, code)
    const footer = publicationFooter(youtube)
    if (!footer) throw new Error('YouTube has a footer')
    expect(composeDescription(youtube)).toBe([...footer.above, '', base.body, '', ...footer.below].join('\n'))
    expect(footer.below).toEqual([
      'Formstep collects what your workflow needs from a customer, one request at a time.',
      'Code ADA20: 20% off for 3 months.',
      'http://localhost:3300/go/abc',
    ])
    expect(publicationFooter(args('tiktok', base.body, null))?.below.at(-1)).toBe('Link in bio.')
  })

  it('sends the title alone on X, with no footer and no code', () => {
    const x = args('x', undefined, code)
    expect(composeDescription(x)).toBe('Retries and money')
    expect(publicationFooter(x)).toBeNull()
  })

  it('treats a title over the X limit, or a video off X without a body, as a broken invariant', () => {
    const long = args('x', undefined, null)
    expect(() => composeDescription({ ...long, publication: { ...long.publication, title: 'a'.repeat(281) } })).toThrow('over 280')
    expect(() => composeDescription(args('youtube', undefined, null))).toThrow('has no body')
  })
})

describe('assertXTitleFits', () => {
  it('takes a title X takes and refuses a longer one', () => {
    expect(() => assertXTitleFits('a'.repeat(280))).not.toThrow()
    expect(() => assertXTitleFits('a'.repeat(281))).toThrow('The title is 281 characters; X allows 280.')
  })
})
