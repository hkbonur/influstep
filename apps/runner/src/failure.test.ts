import { describe, expect, it } from 'vitest'
import { ShotRecordingError, failureOf } from './failure'

describe('a failed job as the runner reports it', () => {
  it("names the shot whose recording broke and keeps the tool's own error word for word", () => {
    const cause = new Error('page.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator("#run")')
    expect(failureOf(new ShotRecordingError('shot-3', cause))).toEqual({
      error: 'page.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator("#run")',
      shotId: 'shot-3',
    })
  })

  it('names no shot for any other failure', () => {
    expect(failureOf(new Error('ffmpeg exited with code 1'))).toEqual({ error: 'ffmpeg exited with code 1' })
    expect(failureOf('a thrown string')).toEqual({ error: 'a thrown string' })
  })
})
