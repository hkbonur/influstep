import { describe, expect, it } from 'vitest'
import { mockVoiceId, spokenSeconds } from './voice'

describe('spokenSeconds', () => {
  it('reads about 2.4 words a second and never under two seconds', () => {
    expect(spokenSeconds('one two three')).toBe(2)
    expect(spokenSeconds(Array.from({ length: 48 }, () => 'word').join(' '))).toBe(20)
  })
})

describe('mockVoiceId', () => {
  it('names the mock voice after the persona', () => {
    expect(mockVoiceId('Nora Notion')).toBe('mock-voice-nora-notion')
  })
})
