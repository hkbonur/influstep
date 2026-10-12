import { PERSONA_COLORS } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { PERSONA_TEXT_CLASS, personaAvatarState } from './persona-avatar'

describe('PERSONA_TEXT_CLASS', () => {
  // Tailwind only emits class names it finds written out, so each shared color needs its own literal entry.
  it('has one entry per persona color and nothing else', () => {
    expect(new Set(Object.keys(PERSONA_TEXT_CLASS))).toEqual(new Set(PERSONA_COLORS))
  })

  it('names the persona color utility for each color', () => {
    for (const color of PERSONA_COLORS) {
      expect(PERSONA_TEXT_CLASS[color]).toBe(`text-persona-${color}`)
    }
  })
})

describe('personaAvatarState', () => {
  it('thinks while a job is queued or running, and rests otherwise', () => {
    expect(personaAvatarState({ working: true, paused: false })).toBe('thinking')
    expect(personaAvatarState({ working: false, paused: false })).toBe('idle')
  })

  // The runner leaves a paused persona's jobs queued, so `working` stays true for as long as the pause lasts.
  it('rests while paused, even with jobs in its queue', () => {
    expect(personaAvatarState({ working: true, paused: true })).toBe('idle')
  })
})
