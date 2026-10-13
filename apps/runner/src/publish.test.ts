import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublishPayload } from '@influstep/shared'
import { publish } from './publish'

const POST: PublishPayload = { kind: 'post', publicationId: 'pub-post-1', platform: 'x', parts: ['One line.'], scheduledAt: 0 }
const VIDEO: PublishPayload = {
  kind: 'video',
  publicationId: 'pub-video-1',
  platform: 'x',
  title: 'A video',
  // A video's X text is its title, nothing appended.
  description: 'A video',
  renderStorageId: 'storage-1',
  renderUrl: 'https://example.test/render.mp4',
  scheduledAt: 0,
}

describe('publish to X', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reports a mock post for a post and a video alike, the same one for a retried job', async () => {
    vi.stubEnv('PROVIDERS_MODE', 'mock')
    for (const payload of [POST, VIDEO]) {
      const result = await publish({ id: 'job-1', payload })
      expect(result.externalId).toMatch(/^x-mock-[0-9a-f]{8}$/)
      expect(result.url).toBe(`https://x.com/i/status/${result.externalId}`)
      expect(result.mock).toBe(true)
      expect((await publish({ id: 'job-2', payload })).externalId).toBe(result.externalId)
    }
  })

  it('refuses in real mode and names the key the adapter waits for', async () => {
    vi.stubEnv('PROVIDERS_MODE', 'real')
    for (const payload of [POST, VIDEO]) {
      await expect(publish({ id: 'job-1', payload })).rejects.toThrow('X publishing needs X_OAUTH; the X adapter is not built yet.')
    }
  })
})
