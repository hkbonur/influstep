import { describe, expect, it } from 'vitest'
import { formatDay } from './format'
import { ideaExplanation, ideaLine } from './ideas'

const dayWords = (day: string) => formatDay(day, { weekday: 'short', day: 'numeric', month: 'short' })

describe('ideaLine', () => {
  it('names the day before a video goes out as its script day', () => {
    expect(ideaLine({ kind: 'video', plannedFor: '2026-10-15' }, false)).toBe(`Script on ${dayWords('2026-10-14')}`)
  })
  it('counts back across a month end', () => {
    expect(ideaLine({ kind: 'video', plannedFor: '2026-11-01' }, false)).toBe(`Script on ${dayWords('2026-10-31')}`)
  })
  it('says when a post is written, since a post has no script', () => {
    expect(ideaLine({ kind: 'thread', plannedFor: '2026-10-15' }, false)).toBe(`Writing on ${dayWords('2026-10-14')}`)
  })
  it('says the writer is on it while its write job waits or runs', () => {
    expect(ideaLine({ kind: 'video', plannedFor: '2026-10-15' }, true)).toBe('Writing now')
    expect(ideaLine({ kind: 'text', plannedFor: '2026-10-15' }, true)).toBe('Writing now')
  })
})

describe('ideaExplanation', () => {
  it('names the script for a video and the post for a post', () => {
    expect(ideaExplanation('video')).toBe('I write the script the day before it goes out, after a last look at what moved that morning.')
    expect(ideaExplanation('image')).toBe('I write the post the day before it goes out, after a last look at what moved that morning.')
  })
})
