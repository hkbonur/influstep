import {
  POST_INTENTS,
  RUNNER_STALE_MS,
  isPost,
  postHook,
  postProblems,
  postSlotHours,
  runnerJobSchema,
  type PlatformFormat,
  type PostKind,
} from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { addDays, dayKey, instantAt, weekStart } from './core/dates'
import { writeScriptsDueBefore } from '../test/scripts'
import { setup } from '../test/setup'

const TIMEZONE = 'Europe/Oslo'
const KINDS: PostKind[] = ['text', 'image', 'thread']

// Two posts a day from 22:00 run past midnight, so the slots move back to 20:00 and 23:00.
const X_FORMAT: PlatformFormat = {
  platform: 'x',
  lengthSec: 60,
  aspect: '16:9',
  delivery: 'talking_head',
  hookNote: 'Put the point in the first line; the video proves it.',
  publishHour: 22,
  cadence: { postsPerDay: 2, kinds: KINDS, intents: [...POST_INTENTS] },
}

type Test = ReturnType<typeof setup>

/** A workspace and one persona that publishes only on X, inserted directly so the test owns every row it reads. */
async function xPersona(t: Test): Promise<Id<'personas'>> {
  return t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert('workspaces', {
      name: 'Test',
      sponsorName: 'Formstep',
      sponsorUrl: 'https://formstep.io',
      appUrl: 'http://localhost:3300',
      signInRequiredHosts: [],
      signedInHosts: [],
      valuePerPaid: 29,
      currency: 'EUR',
    })
    return ctx.db.insert('personas', {
      workspaceId,
      name: 'Xena Posts',
      color: 'iris',
      handle: 'xena.posts',
      niche: 'automation for small teams',
      tone: 'plain',
      bio: 'One automation a day.',
      bible: 'Xena says the point first and never says "guys".',
      pillars: ['n8n tutorials', 'AI agent workflows'],
      formats: [X_FORMAT],
      voiceId: 'mock-xena',
      sponsorDial: 0.5,
      sponsorRampEpisodes: 0,
      episodesPerWeek: 1,
      autoApprove: false,
      autoPublish: false,
      paused: false,
      timezone: TIMEZONE,
      createdAt: Date.now(),
    })
  })
}

async function episodesOf(t: Test, personaId: Id<'personas'>) {
  return t.run((ctx) =>
    ctx.db
      .query('episodes')
      .withIndex('by_persona', (q) => q.eq('personaId', personaId))
      .collect()
  )
}

describe('posts on X', () => {
  it('plans post slots by the cadence and writes every post inside X limits', async () => {
    const t = setup()
    const personaId = await xPersona(t)
    await t.run(async (ctx) => {
      for (const [index, title] of ['n8n webhooks that retry', 'Agents that ask for approval'].entries()) {
        await ctx.db.insert('signals', {
          personaId,
          source: 'hackernews',
          externalId: `hn-${index}`,
          title,
          url: `https://news.ycombinator.com/item?id=${index}`,
          summary: 'People ask how.',
          score: 100 - index,
          topics: ['n8n'],
          status: 'new',
          foundAt: Date.now(),
          mock: true,
        })
      }
    })

    // Next week, so no slot is in the past.
    const nextMonday = addDays(weekStart(dayKey(Date.now(), TIMEZONE)), 7)
    const first = await t.mutation(internal.internal.agents.planWeekMutation, { personaId, weekStart: nextMonday })
    expect(first.planned).toBe(1 + 7 * 2)
    const planned = await episodesOf(t, personaId)

    // The video slot is unchanged and goes to X too.
    const videos = planned.filter((episode) => episode.kind === 'video')
    expect(videos.map((episode) => episode.platforms)).toEqual([['x']])

    // Every day at the cadence's hours, only to X. The kind follows the planned length (voice.integration.test.ts pins
    // the mix): a thread exactly when the post is long, and every kind one the cadence has.
    const posts = planned.filter((episode) => isPost(episode.kind)).sort((a, b) => a.scheduledAt - b.scheduledAt)
    const hours = postSlotHours(X_FORMAT)
    const week = Array.from({ length: 7 }, (_, offset) => addDays(nextMonday, offset))
    expect(posts.map((post) => [post.plannedFor, post.scheduledAt])).toEqual(
      week.flatMap((day) => hours.map((hour) => [day, instantAt(day, hour, TIMEZONE)]))
    )
    for (const post of posts) {
      expect(KINDS).toContain(post.kind)
      expect(post.kind === 'thread').toBe(post.length === 'long')
    }
    expect(posts.every((post) => post.status === 'idea' && post.platforms.length === 1 && post.platforms[0] === 'x')).toBe(true)

    // The dial sponsors some posts, always as a mention: a post shows no screen to demo on.
    expect(posts.some((post) => post.sponsorSegment === 'mention')).toBe(true)
    expect(posts.some((post) => post.sponsorSegment === 'demo')).toBe(false)

    // The video took the strongest signal, a post the other; no signal feeds two episodes.
    const fed = planned.flatMap((episode) => episode.signalIds)
    expect(fed.length).toBe(2)
    expect(new Set(fed).size).toBe(2)

    // A second plan of the same week finds every slot taken.
    const second = await t.mutation(internal.internal.agents.planWeekMutation, { personaId, weekStart: nextMonday })
    expect(second.planned).toBe(0)

    // Nothing is written at plan time: each day's posts are written the morning before it, one pass a morning.
    await t.finishAllScheduledFunctions(() => {})
    expect((await episodesOf(t, personaId)).every((episode) => episode.status === 'idea')).toBe(true)
    for (const day of week) {
      const pass = await writeScriptsDueBefore(t, personaId, day)
      expect(pass.failed).toBe(0)
    }

    // The writer: every post is scripted with parts that pass X's rules as they stand, since X gets them as written.
    const written = (await episodesOf(t, personaId)).filter((episode) => isPost(episode.kind))
    expect(written.length).toBe(14)
    for (const episode of written) {
      if (!isPost(episode.kind)) throw new Error('expected a post')
      expect(episode.status).toBe('scripted')
      if (!episode.post) throw new Error(`post ${episode._id} was not written`)
      expect(postProblems(episode.kind, episode.post)).toEqual([])
      expect(episode.hook).toBe(postHook(episode.post.parts))
      expect(episode.hook.length).toBeGreaterThan(0)
      expect(episode.format).toBeUndefined()
      expect(episode.shots).toEqual([])
    }
    expect(written.find((episode) => episode.kind === 'image')?.post?.cardTitle).toBeTruthy()
    expect(written.find((episode) => episode.kind === 'thread')?.post?.parts.length).toBeGreaterThan(1)
  })

  it('hands the runner a due post with its parts as written, and an image post with its card', async () => {
    const t = setup()
    const personaId = await xPersona(t)
    const due = Date.now() - 60_000
    const cardStorageId = await t.run((ctx) => ctx.storage.store(new Blob(['card'], { type: 'image/png' })))
    const insertPost = (kind: PostKind, post: { parts: string[]; cardTitle?: string }, aspect?: '16:9') =>
      t.run(async (ctx) => {
        const episodeId = await ctx.db.insert('episodes', {
          personaId,
          kind,
          slug: `post-${kind}`,
          status: 'scheduled',
          concept: `A ${kind} post`,
          title: `A ${kind} post`,
          hook: postHook(post.parts),
          post,
          sponsorSegment: 'none',
          platforms: ['x'],
          shots: [],
          renders: aspect ? [{ aspect, storageId: cardStorageId, durationSec: 0, mock: true }] : [],
          plannedFor: dayKey(due, TIMEZONE),
          scheduledAt: due,
          signalIds: [],
          createdAt: due,
          updatedAt: due,
        })
        const linkId = await ctx.db.insert('links', {
          slug: `link${kind}`,
          personaId,
          episodeId,
          platform: 'x',
          target: 'https://formstep.io',
          clicks: 0,
          createdAt: due,
        })
        const publicationId = await ctx.db.insert('publications', {
          episodeId,
          personaId,
          platform: 'x',
          aspect,
          status: 'queued',
          title: `A ${kind} post`,
          parts: post.parts,
          linkId,
          scheduledAt: due,
          mock: true,
        })
        return { episodeId, publicationId }
      })
    const text = await insertPost('text', { parts: ['Retries belong in the workflow, not in your head.'] })
    const image = await insertPost('image', { parts: ['The one n8n setting I change first.'], cardTitle: 'Retry on fail' }, '16:9')

    const dispatched = await t.mutation(internal.internal.runner.dispatchDuePublications, { now: Date.now() })
    expect(dispatched.dispatched).toBe(2)
    // The runner claims each job, reads its payload through the shared contract, and reports it live.
    const payloads = new Map<string, unknown>()
    for (const externalId of ['x-mock-0123abcd', 'x-mock-4567ef01']) {
      const claimed = runnerJobSchema.parse(await t.mutation(internal.internal.runner.claimNext, { runnerName: 'test' }))
      if (claimed.kind !== 'publish') throw new Error('expected a publish job')
      payloads.set(claimed.payload.publicationId, claimed.payload)
      await t.mutation(internal.internal.runner.complete, {
        jobId: claimed.id as Id<'jobs'>,
        result: { externalId, url: `https://x.com/i/status/${externalId}`, publishedAt: Date.now(), mock: true },
      })
    }

    expect(payloads.get(text.publicationId)).toEqual({
      kind: 'post',
      publicationId: text.publicationId,
      platform: 'x',
      parts: ['Retries belong in the workflow, not in your head.'],
      scheduledAt: due,
    })
    expect(payloads.get(image.publicationId)).toMatchObject({
      kind: 'post',
      platform: 'x',
      parts: ['The one n8n setting I change first.'],
      mediaStorageId: cardStorageId,
      mediaUrl: expect.stringContaining('http'),
    })
    for (const post of [text, image]) {
      expect((await t.run((ctx) => ctx.db.get(post.publicationId)))?.status).toBe('live')
      expect((await t.run((ctx) => ctx.db.get(post.episodeId)))?.status).toBe('published')
    }
  })

  it('puts a running job back in the queue when no runner process reports it, and never hands a live job to a twin', async () => {
    const t = setup()
    for (const name of ['laptop', 'desktop']) {
      await t.mutation(internal.internal.runner.heartbeat, { name, version: '0.1.0', providersMode: 'mock', jobId: null })
    }
    const jobId = await t.run((ctx) =>
      ctx.db.insert('jobs', {
        kind: 'open_browser',
        role: 'producer',
        runsOn: 'runner',
        status: 'queued',
        payload: { url: 'http://localhost:5678', checklistItemId: 'item-1' },
        attempts: 0,
        createdAt: Date.now(),
      })
    )
    const runner = (name: string) =>
      t.run((ctx) =>
        ctx.db
          .query('runners')
          .withIndex('by_name', (q) => q.eq('name', name))
          .first()
      )
    const ageJob = (ms: number) => t.run((ctx) => ctx.db.patch(jobId, { startedAt: Date.now() - ms, aliveAt: Date.now() - ms }))

    // The laptop claims the job; nobody else gets it, not even a second process under the same name.
    expect((await t.mutation(internal.internal.runner.claimNext, { runnerName: 'laptop' }))?.id).toBe(jobId)
    expect(await t.mutation(internal.internal.runner.claimNext, { runnerName: 'desktop' })).toBeNull()
    expect(await t.mutation(internal.internal.runner.claimNext, { runnerName: 'laptop' })).toBeNull()
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe('running')

    // A long job stays with the laptop as long as its heartbeat names it.
    await ageJob(RUNNER_STALE_MS + 1_000)
    await t.mutation(internal.internal.runner.heartbeat, { name: 'laptop', version: '0.1.0', providersMode: 'mock', jobId })
    expect(await t.mutation(internal.internal.runner.claimNext, { runnerName: 'desktop' })).toBeNull()

    // The laptop goes quiet past the threshold the Providers page uses: the next claim takes the job back.
    await ageJob(RUNNER_STALE_MS + 1_000)
    const laptopBefore = await runner('laptop')
    expect((await t.mutation(internal.internal.runner.claimNext, { runnerName: 'desktop' }))?.id).toBe(jobId)
    const reclaimed = await t.run((ctx) => ctx.db.get(jobId))
    expect(reclaimed).toMatchObject({ status: 'running', attempts: 2 })
    const laptopAfter = await runner('laptop')
    expect(laptopAfter?.currentJobId).toBeUndefined()
    // Taking the job back is no sign of life from the laptop.
    expect(laptopAfter?.lastSeenAt).toBe(laptopBefore?.lastSeenAt)
    expect((await runner('desktop'))?.currentJobId).toBe(jobId)

    // The desktop finishes; the laptop's late report for the job it lost is refused and changes nothing.
    await t.mutation(internal.internal.runner.complete, { jobId, result: { opened: 'http://localhost:5678' } })
    await expect(t.mutation(internal.internal.runner.complete, { jobId, result: { opened: 'http://localhost:5678' } })).rejects.toThrow(
      'is done, not running'
    )
    await expect(t.mutation(internal.internal.runner.fail, { jobId, error: 'lost' })).rejects.toThrow('is done, not running')
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe('done')
  })
})
