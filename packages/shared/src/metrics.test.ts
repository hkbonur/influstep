import { describe, expect, it } from 'vitest'
import { normalizeDiscountCode } from './metrics'

describe('normalizeDiscountCode', () => {
  it('upper-cases and trims a plain code', () => {
    expect(normalizeDiscountCode(' ada20 ')).toBe('ADA20')
  })
  it('rejects spaces, punctuation and short strings', () => {
    expect(normalizeDiscountCode('ADA 20')).toBeNull()
    expect(normalizeDiscountCode('AD')).toBeNull()
    expect(normalizeDiscountCode('ada-20')).toBeNull()
  })
})
