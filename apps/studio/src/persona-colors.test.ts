import { readFileSync } from 'node:fs'
import { PERSONA_COLORS, PERSONA_COLOR_VALUES } from '@influstep/shared'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

describe('persona colors', () => {
  it('draw the same in the backend as in the studio (styles.css is the source)', () => {
    for (const color of PERSONA_COLORS) {
      const declared = styles.match(new RegExp(`--color-persona-${color}:\\s*([^;]+);`))?.[1]?.trim()
      const ink = styles.match(/--color-ink:\s*([^;]+);/)?.[1]?.trim()
      expect(declared === 'var(--color-ink)' ? ink : declared, color).toBe(PERSONA_COLOR_VALUES[color])
    }
  })
})
