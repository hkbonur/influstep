import { describe, expect, it } from 'vitest'
import { bioPage } from './index'

describe('bioPage', () => {
  it('renders the persona, its episodes, and the tracked sponsor link', () => {
    const html = bioPage({
      name: 'Ada',
      handle: 'ada.automates',
      bio: 'One n8n fix a day.',
      sponsorName: 'Formstep',
      sponsorSlug: 'ada-bio',
      episodes: [{ title: 'Retry a webhook', url: 'https://youtube.com/watch?v=1', platform: 'youtube' }],
    })
    expect(html).toContain('@ada.automates')
    expect(html).toContain('href="/go/ada-bio"')
    expect(html).toContain('Retry a webhook')
    expect(html).not.toContain('<script')
  })

  it('escapes HTML in persona text and omits the sponsor without a slug', () => {
    const html = bioPage({ name: '<b>x</b>', handle: 'h', bio: '', sponsorName: 'Formstep', sponsorSlug: null, episodes: [] })
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('class="sponsor"')
  })

  it('sends the sponsor click on with the platform whose bio linked the page', () => {
    const html = bioPage({
      name: 'Max',
      handle: 'max',
      bio: '',
      sponsorName: 'Formstep',
      sponsorSlug: 'max-bio',
      episodes: [],
      via: 'tiktok',
    })
    expect(html).toContain('href="/go/max-bio?via=tiktok"')
  })
})
