import { describe, expect, it } from 'vitest'
import { addDays, formatCount, formatHour, formatMoney, weekStart } from './format'

describe('format', () => {
  it('shortens counts the way a report reads them', () => {
    expect(formatCount(950)).toBe('950')
    expect(formatCount(1_240)).toBe('1.2k')
    expect(formatCount(12_400)).toBe('12k')
    expect(formatCount(2_500_000)).toBe('2.5M')
  })
  it('rounds money to whole units in the given currency', () => {
    const usd = formatMoney(1234.6, 'USD')
    expect(usd.replace(/\D/g, '')).toBe('1235')
    expect(usd).toMatch(/\$|USD/)
    expect(formatMoney(0, 'EUR').replace(/\D/g, '')).toBe('0')
  })
  it('writes a publish hour with two digits and no minutes', () => {
    expect(formatHour(9)).toBe('09:00')
    expect(formatHour(16)).toBe('16:00')
  })
  it('finds Monday and walks days across a month end', () => {
    expect(weekStart('2026-10-09')).toBe('2026-10-05')
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
  })
})
