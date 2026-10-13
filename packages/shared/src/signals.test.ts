import { describe, expect, it } from 'vitest'
import { COLD_FRESHNESS, POLLED_SIGNAL_SOURCES, SIGNAL_SOURCES, SIGNAL_SOURCE_LABELS, isCold, signalFreshness } from './signals'

const DAY = 86_400_000
const now = Date.UTC(2026, 9, 13, 9)

describe('signalFreshness', () => {
  it('is the score on the day it was published, halved every two days after', () => {
    expect(signalFreshness({ score: 80, publishedAt: now, foundAt: now }, now)).toBe(80)
    expect(signalFreshness({ score: 80, publishedAt: now - 2 * DAY, foundAt: now }, now)).toBe(40)
    expect(signalFreshness({ score: 80, publishedAt: now - 4 * DAY, foundAt: now }, now)).toBe(20)
    expect(signalFreshness({ score: 80, publishedAt: now - DAY, foundAt: now }, now)).toBe(57)
  })

  it('dates a signal by when it was found when the source does not say when it was published', () => {
    expect(signalFreshness({ score: 60, foundAt: now - 2 * DAY }, now)).toBe(30)
  })

  it('reads the publish time over the find time', () => {
    expect(signalFreshness({ score: 60, publishedAt: now - 10 * DAY, foundAt: now }, now)).toBe(2)
  })

  it('never grows past the score for a time ahead of now', () => {
    expect(signalFreshness({ score: 70, publishedAt: now + DAY, foundAt: now }, now)).toBe(70)
  })
})

describe('isCold', () => {
  it('is cold under the threshold only', () => {
    expect(isCold(COLD_FRESHNESS - 1)).toBe(true)
    expect(isCold(COLD_FRESHNESS)).toBe(false)
  })
})

describe('the signal sources', () => {
  it('polls every source but the comments and the problem log', () => {
    expect(SIGNAL_SOURCES).toEqual(['hackernews', 'reddit', 'google_trends', 'youtube_search', 'search', 'comments', 'problems'])
    expect(POLLED_SIGNAL_SOURCES).toEqual(['hackernews', 'reddit', 'google_trends', 'youtube_search', 'search'])
    expect(SIGNAL_SOURCE_LABELS.search).toBe('Search suggestions')
    expect(SIGNAL_SOURCE_LABELS.problems).toBe('Problem log')
  })
})
