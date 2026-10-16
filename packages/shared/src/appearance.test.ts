import { describe, expect, it } from 'vitest'
import { appearanceFaceProblem, appearanceProblem, isReferenceKind, presenterFace, voiceDescriptionProblem } from './appearance'

describe('appearanceProblem', () => {
  it('lets a presenter use any delivery', () => {
    expect(appearanceProblem('cartoon', [{ delivery: 'talking_head' }, { delivery: 'screen_with_avatar' }])).toBeNull()
  })

  it('holds a Loom-style persona to the screen with its presenter', () => {
    expect(appearanceProblem('loom', [{ delivery: 'screen_with_avatar' }])).toBeNull()
    expect(appearanceProblem('loom', [{ delivery: 'talking_head' }])).toMatch(/Screen with avatar/)
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

describe('presenterFace', () => {
  it('reads the face from the look, and from the operator’s pick on a Loom-style look', () => {
    expect(presenterFace({ style: 'cartoon' })).toBe('cartoon')
    expect(presenterFace({ style: 'loom', face: 'cartoon' })).toBe('cartoon')
    expect(presenterFace({ style: 'voice_only' })).toBeNull()
    expect(() => presenterFace({ style: 'loom' })).toThrow('without its face')
  })

  it('asks for a face on a Loom-style look only', () => {
    expect(appearanceFaceProblem({ style: 'loom' })).toMatch(/cartoon or realistic/)
    expect(appearanceFaceProblem({ style: 'loom', face: 'photoreal' })).toBeNull()
    expect(appearanceFaceProblem({ style: 'photoreal', face: 'cartoon' })).toMatch(/no face to pick/)
  })
})
