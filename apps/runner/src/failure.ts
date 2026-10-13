/**
 * A screen shot's recipe broke on the tool it records: a page that did not
 * load, a button that never showed. The job fails with the shot named, so the
 * backend can log the tool in the persona's problem log. The message is the
 * tool's own error, unchanged, because the problem log quotes its first line.
 */
export class ShotRecordingError extends Error {
  readonly shotId: string

  constructor(shotId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'ShotRecordingError'
    this.shotId = shotId
  }
}

/** What the runner tells the backend about a failed job: the error, and the shot whose recording broke when one did. */
export interface JobFailure {
  error: string
  shotId?: string
}

export function failureOf(error: unknown): JobFailure {
  if (error instanceof ShotRecordingError) return { error: error.message, shotId: error.shotId }
  return { error: error instanceof Error ? error.message : String(error) }
}
