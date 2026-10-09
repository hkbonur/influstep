import { describe, expect, it } from 'vitest'
import { transition } from './pipeline'

describe('transition', () => {
  it('walks the happy path', () => {
    expect(transition('idea', { type: 'script_written' })).toEqual({ ok: true, status: 'scripted' })
    expect(transition('scripted', { type: 'approved' })).toEqual({ ok: true, status: 'recording' })
    expect(transition('recording', { type: 'produced' })).toEqual({ ok: true, status: 'rendered' })
    expect(transition('rendered', { type: 'scheduled' })).toEqual({ ok: true, status: 'scheduled' })
    expect(transition('scheduled', { type: 'published' })).toEqual({ ok: true, status: 'published' })
    expect(transition('published', { type: 'measured' })).toEqual({ ok: true, status: 'measured' })
  })
  it('refuses to approve what has no script', () => {
    expect(transition('idea', { type: 'approved' }).ok).toBe(false)
  })
  it('retries to where it failed', () => {
    expect(transition('failed', { type: 'retry' }, { previous: 'recording' })).toEqual({ ok: true, status: 'recording' })
    expect(transition('failed', { type: 'retry' }).ok).toBe(false)
  })
})
