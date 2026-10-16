import { describe, expect, it } from 'vitest'
import { mockSignals } from './mock'

describe('mock signals', () => {
  it('keeps the fixed automation stories for a persona they touch', async () => {
    const found = await mockSignals('reddit').find({ terms: ['n8n tutorials'], since: 0, limit: 5 })
    expect(found[0]?.title).toBe('n8n webhook fails silently when the client sends a form, how do I debug?')
  })

  it('tells a persona in another niche stories about its own terms', async () => {
    const found = await mockSignals('hackernews').find({ terms: ['Figma how-tos', 'design systems'], since: 0, limit: 5 })
    expect(found.map((signal) => signal.title)).toEqual([
      'Ask HN: What does your figma how-tos setup look like?',
      'Show HN: I automated the boring part of design systems',
    ])
  })
})
