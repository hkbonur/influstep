import { describe, expect, it } from 'vitest'
import { EPISODE_STATUSES, EPISODE_TRANSITIONS, canTransition } from './episode-status'

describe('episode transitions', () => {
  it('lists every status exactly once', () => {
    expect(Object.keys(EPISODE_TRANSITIONS).sort()).toEqual([...EPISODE_STATUSES].sort())
  })
  it('lets a failed episode retry from where it stood but never skip to measured', () => {
    expect(canTransition('failed', 'recording')).toBe(true)
    expect(canTransition('failed', 'measured')).toBe(false)
  })
  it('keeps measured and killed terminal', () => {
    expect(EPISODE_TRANSITIONS.measured).toEqual([])
    expect(EPISODE_TRANSITIONS.killed).toEqual([])
  })
})
