import fs from 'node:fs/promises'
import { runnerJobSchema, type RunnerJob } from '@influstep/shared'
import { config, providersMode } from './config'

/** The runner's HTTP client for packages/convex/src/http.ts. */

async function call<T>(route: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.siteUrl()}${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${route} → ${response.status}: ${text}`)
  return JSON.parse(text) as T
}

export const backend = {
  async heartbeat(): Promise<void> {
    await call('/runner/heartbeat', { name: config.name(), version: config.version, providersMode: providersMode() })
  },
  async claim(): Promise<RunnerJob | null> {
    const { job } = await call<{ job: unknown }>('/runner/claim', { name: config.name() })
    if (job === null) return null
    return runnerJobSchema.parse(job)
  },
  async complete(jobId: string, result: unknown): Promise<void> {
    await call('/runner/complete', { jobId, result })
  },
  async fail(jobId: string, error: string): Promise<void> {
    await call('/runner/fail', { jobId, error })
  },
  /** Uploads a file to Convex storage and returns its storage id. */
  async upload(file: string, contentType: string): Promise<string> {
    const { uploadUrl } = await call<{ uploadUrl: string }>('/runner/upload-url', {})
    const bytes = await fs.readFile(file)
    const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes })
    if (!response.ok) throw new Error(`upload failed: ${response.status} ${await response.text()}`)
    const { storageId } = (await response.json()) as { storageId: string }
    return storageId
  },
}
