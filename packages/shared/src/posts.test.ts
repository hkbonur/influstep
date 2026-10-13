import { describe, expect, it } from 'vitest'
import { DEFAULT_FORMATS, type PlatformFormat } from './formats'
import { postHook, postProblems, postSlotHours, xLength } from './posts'

const LINK = 'http://localhost:3300/go/abc1234'
const x: PlatformFormat = { platform: 'x', ...DEFAULT_FORMATS.x }

describe('xLength', () => {
  it('counts plain text by code point', () => {
    expect(xLength('Retry the node.')).toBe(15)
    expect(xLength('café ✅')).toBe(6)
  })
  it('weighs every link 23, whatever its length', () => {
    expect(xLength('https://x.co')).toBe(23)
    expect(xLength(`see ${LINK} and http://a.very.long.example.com/with/a/path?q=1 now`)).toBe(4 + 23 + 5 + 23 + 4)
  })
})

describe('postSlotHours', () => {
  it('spaces the posts three hours from the publish hour', () => {
    expect(postSlotHours(x)).toEqual([15, 18])
    expect(postSlotHours({ ...x, cadence: { postsPerDay: 1, kinds: ['text'], intents: ['ask'] } })).toEqual([15])
  })
  it('slides the day earlier so the last post lands by 23', () => {
    expect(postSlotHours({ ...x, cadence: { postsPerDay: 4, kinds: ['text'], intents: ['ask'] } })).toEqual([14, 17, 20, 23])
    expect(postSlotHours({ ...x, publishHour: 23, cadence: { postsPerDay: 2, kinds: ['text'], intents: ['ask'] } })).toEqual([20, 23])
  })
  it('never goes below midnight', () => {
    expect(postSlotHours({ ...x, publishHour: 23, cadence: { postsPerDay: 9, kinds: ['text'], intents: ['ask'] } })[0]).toBe(0)
  })
  it('throws for a format without a cadence', () => {
    expect(() => postSlotHours({ platform: 'tiktok', ...DEFAULT_FORMATS.tiktok })).toThrow('no post cadence')
  })
})

describe('postHook', () => {
  it('is the first line of the first part, trimmed', () => {
    expect(postHook(['  n8n retries three times.  \nSet it per node.', 'Part two.'])).toBe('n8n retries three times.')
    expect(postHook(['\nAfter a blank line.'])).toBe('After a blank line.')
    expect(postHook([])).toBe('')
  })
})

describe('postProblems', () => {
  it('accepts a post that fits', () => {
    expect(postProblems('text', { parts: ['Short and true.'] })).toEqual([])
    expect(postProblems('thread', { parts: ['a'.repeat(280), 'b'.repeat(280)] })).toEqual([])
    expect(postProblems('image', { parts: ['Caption.'], cardTitle: 'c'.repeat(60) })).toEqual([])
  })
  it('counts the parts by kind', () => {
    expect(postProblems('text', { parts: ['One.', 'Two.'] })).toEqual(['A text post is one part.'])
    expect(postProblems('image', { parts: [], cardTitle: 'Card' })).toEqual(['An image post is one part.'])
    expect(postProblems('thread', { parts: ['One.'] })).toEqual(['A thread is 2 to 6 parts.'])
    expect(postProblems('thread', { parts: Array.from({ length: 7 }, () => 'Part.') })).toEqual(['A thread is 2 to 6 parts.'])
  })
  it('names an empty part and a part over the limit, the last part included', () => {
    expect(postProblems('thread', { parts: ['One.', '  ', 'Three.'] })).toEqual(['Part 2 is empty.'])
    expect(postProblems('thread', { parts: ['One.', 'b'.repeat(281), 'Three.'] })).toEqual(['Part 2 is 281 characters; X allows 280.'])
    expect(postProblems('text', { parts: ['a'.repeat(281)] })).toEqual(['Part 1 is 281 characters; X allows 280.'])
  })
  it('weighs a link in a part 23', () => {
    expect(postProblems('text', { parts: [`${'a'.repeat(256)} ${LINK}`] })).toEqual([])
    expect(postProblems('text', { parts: [`${'a'.repeat(257)} ${LINK}`] })).toEqual(['Part 1 is 281 characters; X allows 280.'])
  })
  it('needs a card title that fits the card on an image post', () => {
    expect(postProblems('image', { parts: ['Caption.'] })).toEqual(['An image post needs a card title.'])
    expect(postProblems('image', { parts: ['Caption.'], cardTitle: '   ' })).toEqual(['An image post needs a card title.'])
    expect(postProblems('image', { parts: ['Caption.'], cardTitle: 'c'.repeat(61) })).toEqual([
      'The card title is 61 characters; the card fits 60.',
    ])
  })
  it('lists every problem in order', () => {
    expect(postProblems('image', { parts: ['', 'two'] })).toEqual([
      'An image post is one part.',
      'Part 1 is empty.',
      'An image post needs a card title.',
    ])
  })
})
