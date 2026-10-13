import {
  DEFAULT_LENGTH_MIX,
  POST_INTENTS,
  isPost,
  pickLengths,
  postLengthOf,
  postProblems,
  voiceEditProblems,
  voiceStats,
  type ImportedPost,
  type PlatformFormat,
  type PostKind,
  type Voice,
} from '@influstep/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { DELETE_PAGE_SIZE, HISTORY_BEING_DELETED } from './core/account'
import { addDays, dayKey, weekStart } from './core/dates'
import { enqueueJob } from './jobs/queue'
import { MOCK_HISTORY_SIZE, X_TIMELINE_NEEDS_OAUTH, mockXHistory } from './providers/timeline'
import { writeScriptsDueBefore } from '../test/scripts'
import { setup } from '../test/setup'

const TIMEZONE = 'Europe/Oslo'
const HANDLE = 'xena.posts'
const NICHE = 'automation for small teams'
const PILLARS = ['n8n tutorials', 'AI agent workflows']

function xFormat(kinds: PostKind[]): PlatformFormat {
  return {
    platform: 'x',
    lengthSec: 60,
    aspect: '16:9',
    delivery: 'talking_head',
    hookNote: 'Put the point in the first line.',
    publishHour: 9,
    cadence: { postsPerDay: 2, kinds, intents: [...POST_INTENTS], repliesPerDay: 5 },
  }
}

type Test = ReturnType<typeof setup>

/** A workspace and one persona that publishes only on X, inserted directly so the test owns every row it reads. */
async function xPersona(t: Test, options: { kinds: PostKind[]; voice?: Voice }): Promise<Id<'personas'>> {
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
      handle: HANDLE,
      niche: NICHE,
      tone: 'plain',
      bio: 'One automation a day.',
      bible: 'Xena says the point first.',
      pillars: PILLARS,
      formats: [xFormat(options.kinds)],
      voiceId: 'mock-xena',
      sponsorDial: 0.5,
      sponsorRampEpisodes: 0,
      episodesPerWeek: 1,
      autoApprove: false,
      autoPublish: false,
      paused: false,
      timezone: TIMEZONE,
      ...(options.voice ? { voice: options.voice } : {}),
      createdAt: Date.now(),
    })
  })
}

/** Queues a backend job the way the studio does and runs it to the end; returns the finished job. */
async function runJob(t: Test, kind: 'import_x_history' | 'learn_voice', personaId: Id<'personas'>): Promise<Doc<'jobs'>> {
  const jobId = await t.run((ctx) => enqueueJob(ctx, { kind, payload: { personaId }, personaId }))
  await t.finishAllScheduledFunctions(() => {})
  const job = await t.run((ctx) => ctx.db.get(jobId))
  if (!job) throw new Error(`job ${jobId} is gone`)
  return job
}

async function accountPostsOf(t: Test, personaId: Id<'personas'>): Promise<Doc<'accountPosts'>[]> {
  return t.run((ctx) =>
    ctx.db
      .query('accountPosts')
      .withIndex('by_persona_posted', (q) => q.eq('personaId', personaId))
      .collect()
  )
}

async function personaOf(t: Test, personaId: Id<'personas'>): Promise<Doc<'personas'>> {
  const persona = await t.run((ctx) => ctx.db.get(personaId))
  if (!persona) throw new Error(`persona ${personaId} is gone`)
  return persona
}

/** The persona's posts in time order. */
async function postsOf(t: Test, personaId: Id<'personas'>): Promise<Doc<'episodes'>[]> {
  const episodes = await t.run((ctx) =>
    ctx.db
      .query('episodes')
      .withIndex('by_persona', (q) => q.eq('personaId', personaId))
      .collect()
  )
  return episodes.filter((episode) => isPost(episode.kind)).sort((a, b) => a.scheduledAt - b.scheduledAt)
}

function nextMonday(): string {
  return addDays(weekStart(dayKey(Date.now(), TIMEZONE)), 7)
}

function engagement(post: Doc<'accountPosts'>): number {
  return post.likes + post.reposts
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('taking over an X account', () => {
  it('import_x_history in mock mode inserts 40 posts once; a second run adds none', async () => {
    const t = setup()
    const personaId = await xPersona(t, { kinds: ['text', 'image', 'thread'] })

    const first = await runJob(t, 'import_x_history', personaId)
    expect(first.status).toBe('done')
    expect(first.result).toEqual({ added: MOCK_HISTORY_SIZE, skipped: 0 })
    const rows = await accountPostsOf(t, personaId)
    expect(MOCK_HISTORY_SIZE).toBe(40)
    expect(rows.length).toBe(40)
    expect(rows.every((row) => row.source === 'mock' && !row.example)).toBe(true)
    expect(new Set(rows.map((row) => row.externalId)).size).toBe(40)
    // Deterministic per handle: the same ids, parts and counts the timeline serves on its own.
    const served = mockXHistory({ handle: HANDLE, niche: NICHE, pillars: PILLARS, now: Date.now() })
    expect(rows.map((row) => [row.externalId, row.parts, row.likes]).sort()).toEqual(
      served.map((post) => [post.externalId, post.parts, post.likes]).sort()
    )
    // A plausible account: mostly originals, a few replies, some threads, and enough to learn from.
    expect(rows.filter((row) => row.isReply).length).toBeGreaterThan(0)
    expect(rows.filter((row) => !row.isReply).length).toBeGreaterThanOrEqual(30)
    expect(rows.some((row) => row.parts.length > 1)).toBe(true)

    const second = await runJob(t, 'import_x_history', personaId)
    expect(second.status).toBe('done')
    expect(second.result).toEqual({ added: 0, skipped: 40 })
    expect((await accountPostsOf(t, personaId)).length).toBe(40)
  })

  it('import_x_history in real mode fails the job by name until the X adapter exists', async () => {
    const t = setup()
    const personaId = await xPersona(t, { kinds: ['text', 'image', 'thread'] })
    vi.stubEnv('PROVIDERS_MODE', 'real')
    const job = await runJob(t, 'import_x_history', personaId)
    expect(job.status).toBe('failed')
    expect(job.error).toBe(X_TIMELINE_NEEDS_OAUTH)
    expect((await accountPostsOf(t, personaId)).length).toBe(0)
  })

  it('learn_voice in mock mode writes a voice whose length mix is the counted one and marks 5 examples', async () => {
    const t = setup()
    const personaId = await xPersona(t, { kinds: ['text', 'image', 'thread'] })

    // Nothing imported: the analyst refuses in words the operator reads.
    const empty = await runJob(t, 'learn_voice', personaId)
    expect(empty.status).toBe('failed')
    expect(empty.error).toBe('Import at least 10 posts first; there are 0.')

    await runJob(t, 'import_x_history', personaId)
    const rows = await accountPostsOf(t, personaId)
    // An earlier mark the analyst does not pick: learning again replaces every mark.
    const quiet = [...rows].filter((row) => !row.isReply).sort((a, b) => engagement(a) - engagement(b))[0]
    if (!quiet) throw new Error('the mock history has no originals')
    await t.run((ctx) => ctx.db.patch(quiet._id, { example: true }))

    const job = await runJob(t, 'learn_voice', personaId)
    expect(job.status).toBe('done')
    const { voice } = await personaOf(t, personaId)
    if (!voice) throw new Error('learn_voice wrote no voice')
    const stats = voiceStats(rows)
    expect(voice.lengthMix).toEqual(stats.lengthMix)
    expect(voice.emoji).toBe(stats.emoji)
    expect(voice.hashtags).toBe(stats.hashtags)
    expect(voice.sampleSize).toBe(rows.filter((row) => !row.isReply).length)
    expect(voice.learnedAt).toBeGreaterThan(0)
    // The majority language of the originals, and a summary and traits the operator could have typed.
    expect(voice.language).toBe('en')
    expect(voiceEditProblems(voice)).toEqual([])
    expect(voice.summary).toContain('plain')

    // The five originals with the most likes plus reposts, and only those.
    const after = await accountPostsOf(t, personaId)
    const examples = after.filter((row) => row.example)
    expect(examples.length).toBe(5)
    expect(examples.every((row) => !row.isReply)).toBe(true)
    const weakestExample = Math.min(...examples.map(engagement))
    const strongestOther = Math.max(...after.filter((row) => !row.example && !row.isReply).map(engagement))
    expect(weakestExample).toBeGreaterThanOrEqual(strongestOther)
    expect(examples.some((row) => row._id === quiet._id)).toBe(false)

    // A post the writer reads the examples with, most engaging first.
    const [post] = await planAndList(t, personaId)
    if (!post) throw new Error('no post was planned')
    const context = await t.query(internal.internal.data.getEpisodeContext, { episodeId: post._id })
    expect(context.examples.map((row) => row._id).sort()).toEqual(examples.map((row) => row._id).sort())
    const order = context.examples.map(engagement)
    expect(order).toEqual(context.examples.map(engagement).sort((a, b) => b - a))
  })

  it('deletes a history bigger than a page one page at a time, and imports and learning wait until it is gone', async () => {
    // Fake timers hold the scheduled pages back, so the test reads the history between them.
    vi.useFakeTimers()
    const t = setup()
    const personaId = await xPersona(t, { kinds: ['text', 'image', 'thread'] })
    const now = Date.now()
    const bulk = (count: number, prefix: string): ImportedPost[] =>
      Array.from({ length: count }, (_, index) => ({
        externalId: `${prefix}-${index}`,
        parts: [`Post ${index} about n8n.`],
        postedAt: now - index * 60_000,
        likes: index % 50,
        reposts: index % 3,
        replies: 0,
        // One in ten is a reply to someone else.
        isReply: index % 10 === 0,
        lang: 'en',
      }))
    const posts = bulk(DELETE_PAGE_SIZE + 120, 'bulk')
    for (const batch of [posts.slice(0, DELETE_PAGE_SIZE), posts.slice(DELETE_PAGE_SIZE)]) {
      await t.mutation(api.private.account.importPosts, { personaId, source: 'archive', posts: batch })
    }
    const imported = await t.query(api.private.account.history, { personaId, limit: 1 })
    expect(imported.totals).toEqual({
      count: DELETE_PAGE_SIZE + 120,
      originals: DELETE_PAGE_SIZE + 120 - 62,
      replies: 62,
      bySource: { archive: DELETE_PAGE_SIZE + 120, paste: 0, api: 0, mock: 0 },
    })
    // The top posts are read through the engagement index: most likes plus reposts first, the newest among equals, no replies.
    const top = await t.query(api.private.account.topPosts, { personaId, limit: 5 })
    const expected = posts
      .filter((post) => !post.isReply)
      .sort((a, b) => b.likes + b.reposts - (a.likes + a.reposts) || b.postedAt - a.postedAt)
      .slice(0, 5)
    expect(top.map((post) => post.externalId)).toEqual(expected.map((post) => post.externalId))
    const learned: Voice = {
      language: 'en',
      summary: 'Short posts.',
      traits: ['Short'],
      lengthMix: { short: 1, medium: 0, long: 0 },
      emoji: 'never',
      hashtags: 'never',
      sampleSize: 558,
      learnedAt: now,
    }
    await t.run((ctx) => ctx.db.patch(personaId, { voice: learned }))

    // The first page goes at once; the rest is left for the scheduled pages, and the history says so.
    expect(await t.mutation(api.private.account.clearHistory, { personaId })).toEqual({ deleted: DELETE_PAGE_SIZE, more: true })
    const during = await t.query(api.private.account.history, { personaId, limit: 1 })
    expect(during.clearing).toBe(true)
    expect(during.totals.count).toBe(120)
    expect(during.totals.originals + during.totals.replies).toBe(120)
    // A post imported now would be deleted with the rest, and a voice learned now would be cleared.
    await expect(t.mutation(api.private.account.importPosts, { personaId, source: 'paste', posts: bulk(1, 'late') })).rejects.toThrow(
      HISTORY_BEING_DELETED
    )
    await expect(t.mutation(api.private.account.learnVoice, { personaId })).rejects.toThrow(HISTORY_BEING_DELETED)
    // The voice goes with the last page, not the first.
    expect((await personaOf(t, personaId)).voice).toEqual(learned)

    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const after = await t.query(api.private.account.history, { personaId, limit: 1 })
    expect(after).toEqual({
      posts: [],
      totals: { count: 0, originals: 0, replies: 0, bySource: { archive: 0, paste: 0, api: 0, mock: 0 } },
      clearing: false,
    })
    expect(await accountPostsOf(t, personaId)).toEqual([])
    expect((await personaOf(t, personaId)).voice).toBeUndefined()
    expect(await t.query(api.private.personas.get, { personaId })).toMatchObject({ voice: null, account: { posts: 0, examples: 0 } })
  })

  it('plans a week of X posts with rotating intents and lengths from pickLengths, threads only for long', async () => {
    const t = setup()
    const personaId = await xPersona(t, { kinds: ['text', 'image', 'thread'] })
    const monday = nextMonday()
    const result = await t.mutation(internal.internal.agents.planWeekMutation, { personaId, weekStart: monday })
    expect(result.planned).toBe(1 + 7 * 2)

    const posts = await postsOf(t, personaId)
    expect(posts.length).toBe(14)
    // No voice learned yet: the default mix.
    expect(posts.map((post) => post.length)).toEqual(pickLengths(DEFAULT_LENGTH_MIX, 14))
    expect(posts.map((post) => post.intent)).toEqual(posts.map((_, index) => POST_INTENTS[index % POST_INTENTS.length]))
    for (const post of posts) expect(post.kind === 'thread').toBe(post.length === 'long')
    // One-liners and full posts rotate through the other kinds.
    const singles = posts.filter((post) => post.kind !== 'thread')
    expect(singles.map((post) => post.kind)).toEqual(singles.map((_, index) => (index % 2 === 0 ? 'text' : 'image')))

    // The rotation carries on into the next week where this one stopped.
    await t.mutation(internal.internal.agents.planWeekMutation, { personaId, weekStart: addDays(monday, 7) })
    const both = await postsOf(t, personaId)
    expect(both.length).toBe(28)
    expect(both.map((post) => post.intent)).toEqual(both.map((_, index) => POST_INTENTS[index % POST_INTENTS.length]))
  })

  it('follows the learned length mix, and a cadence without threads writes a long slot as a full post', async () => {
    const t = setup()
    const voice: Voice = {
      language: 'en',
      summary: 'Writes threads.',
      traits: ['Mostly threads'],
      lengthMix: { short: 0.25, medium: 0, long: 0.75 },
      emoji: 'never',
      hashtags: 'never',
      sampleSize: 20,
      learnedAt: Date.now(),
    }
    const personaId = await xPersona(t, { kinds: ['text', 'image'], voice })
    await t.mutation(internal.internal.agents.planWeekMutation, { personaId, weekStart: nextMonday() })
    const posts = await postsOf(t, personaId)
    const picked = pickLengths(voice.lengthMix, 14)
    expect(posts.map((post) => post.length)).toEqual(picked.map((length) => (length === 'long' ? 'medium' : length)))
    expect(posts.some((post) => post.kind === 'thread')).toBe(false)
  })

  it('writes every post to its planned length and intent, inside X limits, in the voice language', async () => {
    const t = setup()
    const personaId = await xPersona(t, { kinds: ['text', 'image', 'thread'] })
    await runJob(t, 'import_x_history', personaId)
    await runJob(t, 'learn_voice', personaId)
    const learned = (await personaOf(t, personaId)).voice
    if (!learned) throw new Error('learn_voice wrote no voice')
    await t.run((ctx) => ctx.db.patch(personaId, { voice: { ...learned, language: 'nb' } }))

    const posts = await planAndList(t, personaId)
    expect(posts.map((post) => post.length)).toEqual(pickLengths(learned.lengthMix, 14))
    await t.finishAllScheduledFunctions(() => {})
    // Each day's posts are written the morning before it.
    for (const day of new Set(posts.map((post) => post.plannedFor))) await writeScriptsDueBefore(t, personaId, day)

    const written = await postsOf(t, personaId)
    expect(written.length).toBe(14)
    for (const episode of written) {
      if (!isPost(episode.kind)) throw new Error('expected a post')
      expect(episode.status).toBe('scripted')
      if (!episode.post) throw new Error(`post ${episode._id} was not written`)
      if (!episode.length || !episode.intent) throw new Error(`post ${episode._id} has no length or intent`)
      expect(postProblems(episode.kind, episode.post)).toEqual([])
      expect(postLengthOf(episode.post.parts)).toBe(episode.length)
      // The Norwegian voice reached the writer.
      expect(episode.hook.startsWith('Kort fortalt:')).toBe(true)
      if (episode.intent === 'ask') expect(episode.post.parts.join('\n')).toContain('?')
    }
    expect(new Set(written.map((episode) => episode.length))).toEqual(new Set(['short', 'medium', 'long']))
  })
})

/** Plans next week for the persona and returns its posts in time order. */
async function planAndList(t: Test, personaId: Id<'personas'>): Promise<Doc<'episodes'>[]> {
  await t.mutation(internal.internal.agents.planWeekMutation, { personaId, weekStart: nextMonday() })
  return postsOf(t, personaId)
}
