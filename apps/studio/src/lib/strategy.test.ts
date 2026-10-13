import { describe, expect, it } from 'vitest'
import { nextReviewAt } from './strategy'

describe('nextReviewAt', () => {
  it('is later the same Monday before the slot', () => {
    expect(nextReviewAt(Date.UTC(2026, 9, 12, 6, 0))).toBe(Date.UTC(2026, 9, 12, 6, 30))
  })
  it('moves to the next Monday once the slot has come', () => {
    expect(nextReviewAt(Date.UTC(2026, 9, 12, 6, 30))).toBe(Date.UTC(2026, 9, 19, 6, 30))
    expect(nextReviewAt(Date.UTC(2026, 9, 12, 18, 0))).toBe(Date.UTC(2026, 9, 19, 6, 30))
  })
  it('finds the coming Monday from any other day, across a month end', () => {
    expect(nextReviewAt(Date.UTC(2026, 9, 13, 9, 0))).toBe(Date.UTC(2026, 9, 19, 6, 30))
    expect(nextReviewAt(Date.UTC(2026, 9, 18, 23, 0))).toBe(Date.UTC(2026, 9, 19, 6, 30))
    expect(nextReviewAt(Date.UTC(2026, 9, 31, 12, 0))).toBe(Date.UTC(2026, 10, 2, 6, 30))
  })
})
