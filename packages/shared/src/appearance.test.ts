import { describe, expect, it } from 'vitest'
import { appearanceProblem, isReferenceKind, voiceDescriptionProblem } from './appearance'

describe('appearanceProblem', () => {
  it('lets a presenter use any delivery', () => {
    expect(appearanceProblem('cartoon', [{ delivery: 'talking_head' }, { delivery: 'screen_with_avatar' }])).toBeNull()
  })

  it('holds a persona with no presenter to the screen', () => {
    expect(appearanceProblem('voice_only', [{ delivery: 'screen_only' }])).toBeNull()
    expect(appearanceProblem('voice_only', [{ delivery: 'screen_only' }, { delivery: 'talking_head' }])).toMatch(/Screen only/)
  })
})

describe('isReferenceKind', () => {
  it('takes pictures and clips, not audio or documents', () => {
    expect((['image', 'clip', 'audio', 'document'] as const).map(isReferenceKind)).toEqual([true, true, false, false])
  })
})

describe('voiceDescriptionProblem', () => {
  it('asks for enough words to make a voice from, and no more than the provider takes', () => {
    expect(voiceDescriptionProblem('calm')).toMatch(/at least 20/)
    expect(voiceDescriptionProblem('A calm woman in her thirties, Nordic accent, unhurried.')).toBeNull()
    expect(voiceDescriptionProblem('x'.repeat(1001))).toMatch(/within 1000/)
  })
})
