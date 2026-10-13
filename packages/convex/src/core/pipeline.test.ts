import { describe, expect, it } from 'vitest'
import { transition } from './pipeline'

const video = { kind: 'video' } as const

describe('transition', () => {
  it('walks the happy path', () => {
    expect(transition('idea', { type: 'script_written' }, video)).toEqual({ ok: true, status: 'scripted' })
    expect(transition('scripted', { type: 'approved' }, video)).toEqual({ ok: true, status: 'recording' })
    expect(transition('recording', { type: 'produced' }, video)).toEqual({ ok: true, status: 'rendered' })
    expect(transition('rendered', { type: 'scheduled' }, video)).toEqual({ ok: true, status: 'scheduled' })
    expect(transition('scheduled', { type: 'published' }, video)).toEqual({ ok: true, status: 'published' })
    expect(transition('published', { type: 'measured' }, video)).toEqual({ ok: true, status: 'measured' })
  })
  it('refuses to approve what has no script', () => {
    expect(transition('idea', { type: 'approved' }, video).ok).toBe(false)
  })
  it('retries to where it failed', () => {
    expect(transition('failed', { type: 'retry' }, { ...video, previous: 'recording' })).toEqual({ ok: true, status: 'recording' })
    expect(transition('failed', { type: 'retry' }, video).ok).toBe(false)
  })
  it('schedules a text post or a thread straight from approval', () => {
    expect(transition('scripted', { type: 'scheduled' }, { kind: 'text' })).toEqual({ ok: true, status: 'scheduled' })
    expect(transition('waiting_on_you', { type: 'scheduled' }, { kind: 'thread' })).toEqual({ ok: true, status: 'scheduled' })
  })
  it('makes a video and an image post render before they are scheduled', () => {
    expect(transition('scripted', { type: 'scheduled' }, video)).toEqual({
      ok: false,
      reason: 'Video cannot go from scripted to scheduled: it renders first',
    })
    expect(transition('waiting_on_you', { type: 'scheduled' }, { kind: 'image' }).ok).toBe(false)
    expect(transition('rendered', { type: 'scheduled' }, { kind: 'image' })).toEqual({ ok: true, status: 'scheduled' })
  })
})
