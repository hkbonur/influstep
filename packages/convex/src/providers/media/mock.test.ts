import { describe, expect, it } from 'vitest'
import { cardLines, mockCard } from './mock'

describe('the mock media card', () => {
  it('wraps the prompt at word boundaries and cuts a long one short', () => {
    expect(cardLines('A run history where every execution fails in red')).toEqual(['A run history where every', 'execution fails in red'])
    const long = cardLines(Array.from({ length: 80 }, () => 'word').join(' '))
    expect(long).toHaveLength(5)
    expect(long.at(-1)?.endsWith('…')).toBe(true)
  })

  it('prints the prompt, escaped, on the persona’s color and says it is a mock', () => {
    const svg = mockCard({ kind: 'clip', prompt: 'x', shownPrompt: 'A <red> node & a retry', personaName: 'Ada', color: 'teal' })
    expect(svg).toContain('oklch(55% 0.09 200)')
    expect(svg).toContain('A &lt;red&gt; node &amp; a retry')
    expect(svg).toContain('Clip for Ada · mock, generated')
  })
})
