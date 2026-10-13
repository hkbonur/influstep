import { describe, expect, it } from 'vitest'
import {
  EPISODE_STATUSES,
  EPISODE_STATUS_LABELS,
  EPISODE_TRANSITIONS,
  canTransition,
  textEditable,
  waitsOnOperator,
} from './episode-status'

describe('episode transitions', () => {
  it('lists every status exactly once', () => {
    expect(Object.keys(EPISODE_TRANSITIONS).sort()).toEqual([...EPISODE_STATUSES].sort())
  })
  it('lets a failed episode retry from where it stood but never skip to measured', () => {
    expect(canTransition('failed', 'recording')).toBe(true)
    expect(canTransition('failed', 'measured')).toBe(false)
  })
  it('lets an approved episode go straight to scheduled, for the posts that render nothing', () => {
    expect(canTransition('scripted', 'scheduled')).toBe(true)
    expect(canTransition('waiting_on_you', 'scheduled')).toBe(true)
    expect(canTransition('idea', 'scheduled')).toBe(false)
  })
  it('keeps measured and killed terminal', () => {
    expect(EPISODE_TRANSITIONS.measured).toEqual([])
    expect(EPISODE_TRANSITIONS.killed).toEqual([])
  })
})

describe('textEditable', () => {
  it('keeps the text open until recording starts and again once the episode failed', () => {
    expect(EPISODE_STATUSES.filter(textEditable)).toEqual(['idea', 'scripted', 'waiting_on_you', 'failed'])
  })
})

describe('waitsOnOperator', () => {
  it('counts a script to approve, a sign-in and a publish package, and leaves failed to its own mark', () => {
    expect(EPISODE_STATUSES.filter(waitsOnOperator)).toEqual(['scripted', 'waiting_on_you', 'rendered'])
    expect(waitsOnOperator('failed')).toBe(false)
  })
  it('calls a rendered episode ready to publish', () => {
    expect(EPISODE_STATUS_LABELS.rendered).toBe('Ready to publish')
  })
})
