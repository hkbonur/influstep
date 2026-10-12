import { describe, expect, it } from 'vitest'
import { PERSONA_COLORS, firstUnusedPersonaColor } from './persona-colors'

describe('firstUnusedPersonaColor', () => {
  it('starts the roster on ink', () => {
    expect(firstUnusedPersonaColor([])).toBe('ink')
  })
  it('takes the first color nobody wears, whatever order the roster is in', () => {
    expect(firstUnusedPersonaColor(['violet', 'ink'])).toBe('plum')
    expect(firstUnusedPersonaColor(['teal', 'clay'])).toBe('ink')
    expect(firstUnusedPersonaColor(['ink', 'plum', 'violet', 'iris', 'olive', 'rose'])).toBe('teal')
  })
  it('fills a gap before it repeats a color', () => {
    expect(firstUnusedPersonaColor(['ink', 'ink', 'plum'])).toBe('violet')
  })
  it('repeats the colors in order by roster size once all eight are worn', () => {
    expect(firstUnusedPersonaColor([...PERSONA_COLORS])).toBe('ink')
    expect(firstUnusedPersonaColor([...PERSONA_COLORS, 'teal'])).toBe('plum')
    expect(firstUnusedPersonaColor([...PERSONA_COLORS, ...PERSONA_COLORS])).toBe('ink')
  })
})
