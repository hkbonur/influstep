import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublishPayload } from '@influstep/shared'
import { postReply, publish } from './publish'

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

describe('post a reply on X', () => {
  const REPLY = { replyId: 'reply-1', inReplyTo: '1849', text: 'Cap the retries and log the last one.' }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reports a mock reply of its own, the same one for a retried job', async () => {
    vi.stubEnv('PROVIDERS_MODE', 'mock')
    const result = await postReply({ id: 'job-1', payload: REPLY })
    expect(result).toMatchObject({ externalId: expect.stringMatching(/^x-mock-[0-9a-f]{8}$/), mock: true })
    expect((await postReply({ id: 'job-2', payload: REPLY })).externalId).toBe(result.externalId)
    const post = await publish({ id: 'job-3', payload: { ...POST, publicationId: REPLY.replyId } })
    expect(post.externalId).not.toBe(result.externalId)
  })

  it('refuses in real mode like a post', async () => {
    vi.stubEnv('PROVIDERS_MODE', 'real')
    await expect(postReply({ id: 'job-1', payload: REPLY })).rejects.toThrow('X publishing needs X_OAUTH; the X adapter is not built yet.')
  })
})
