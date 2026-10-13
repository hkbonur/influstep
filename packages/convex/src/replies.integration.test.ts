import { REPLY_REACH_MIN, runnerJobSchema } from '@influstep/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { instantAt } from './core/dates'
import { TIMEZONE, insertPersona } from '../test/fixtures'
import { setup } from '../test/setup'

type Test = ReturnType<typeof setup>

/** The mock listener hears a fresh set every three hours, naming the sponsor in even windows and politics in odd ones. */
const WINDOW_MS = 3 * 3_600_000
const MORNING = instantAt('2026-10-14', 8, TIMEZONE)

beforeEach(() => {
  // Only Date is faked, and it keeps running, so the scheduler's timers and the rows' creation order are real.
  vi.useFakeTimers({ now: MORNING, toFake: ['Date'], shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

async function listenNow(t: Test, persona: Doc<'personas'>): Promise<void> {
  await t.mutation(api.private.replies.listenNow, { personaId: persona._id })
  await t.finishAllScheduledFunctions(() => {})
}

async function view(t: Test, persona: Doc<'personas'>) {
  const page = await t.query(api.private.replies.list, { personaId: persona._id })
  if (!page?.onX) throw new Error('the persona is not on X')
  return page
}

async function setCadence(t: Test, persona: Doc<'personas'>, fields: { repliesPerDay: number; autoPublish?: boolean }): Promise<void> {
  await t.run(async (ctx) => {
    const formats = persona.formats.map((format) =>
      format.cadence ? { ...format, cadence: { ...format.cadence, repliesPerDay: fields.repliesPerDay } } : format
    )
    await ctx.db.patch(persona._id, { formats, autoPublish: fields.autoPublish ?? persona.autoPublish })
  })
}

/** The runner takes the next reply off the queue and X takes it. */
async function runnerSends(t: Test): Promise<string> {
  const job = runnerJobSchema.parse(await t.mutation(internal.internal.runner.claimNext, { runnerName: 'test' }))
  if (job.kind !== 'post_reply') throw new Error(`expected a reply to post, got ${job.kind}`)
  await t.mutation(internal.internal.runner.complete, {
    jobId: job.id as Id<'jobs'>,
    result: {
      externalId: `x-${job.payload.replyId}`,
      url: `https://x.com/i/status/x-${job.payload.replyId}`,
      publishedAt: Date.now(),
      mock: true,
    },
  })
  return job.payload.replyId
}

/** The window parity of the clock now: the mock names the sponsor in an even window. */
function sponsorWindow(): boolean {
  return Math.floor(Date.now() / WINDOW_MS) % 2 === 0
}

/** The docs/plan.md slice 11 engagement: listen, write, who posts, the budget, the numbers. */
describe('engagement on X', () => {
  it('keeps what is worth answering, passes on the sponsor and what a rule covers, and drafts the rest for the operator', async () => {
    const t = setup()
    const persona = await t.run((ctx) => insertPersona(ctx))
    await t.mutation(api.private.personas.sendMessage, { personaId: persona._id, text: 'never reply to politics' })
    await t.finishAllScheduledFunctions(() => {})

    // Two sweeps three hours apart: one hears a post naming the sponsor, the other a post about politics.
    await listenNow(t, persona)
    vi.setSystemTime(Date.now() + WINDOW_MS)
    await listenNow(t, persona)

    const page = await view(t, persona)
    expect(page.goingOut).toEqual([])
    const all = [...page.waiting, ...page.skipped]
    // Per sweep: the mention and the reply under its post, and at most three found posts with reach; the old one is dropped.
    for (const origin of ['mention', 'reply'] as const) expect(all.filter((reply) => reply.origin === origin)).toHaveLength(2)
    const found = all.filter((reply) => reply.origin === 'search')
    expect(found.length).toBeLessThanOrEqual(8)
    for (const reply of found) expect(reply.target.author.followers).toBeGreaterThanOrEqual(REPLY_REACH_MIN)
    expect(new Set(all.map((reply) => reply.inReplyTo)).size).toBe(all.length)

    expect(page.skipped.map((reply) => reply.skipReason).sort()).toEqual([
      'It names Formstep; the persona answers about its sponsor only when you ask.',
      'My rule "Never reply to politics." covers this post.',
    ])
    // Ada does not publish on her own, so even a mention waits for the operator; every draft is a reply that fits X.
    expect(page.waiting.length).toBe(all.length - 2)
    for (const reply of page.waiting) {
      expect(reply.text.length).toBeGreaterThan(0)
      expect(reply.text).not.toContain('Formstep')
    }

    // The same window heard again answers nothing twice.
    await listenNow(t, persona)
    expect((await view(t, persona)).waiting).toHaveLength(page.waiting.length)
  })

  it('posts a draft on one click within the budget, refuses past it, and lets a failed reply go out again', async () => {
    const t = setup()
    const persona = await t.run((ctx) => insertPersona(ctx))
    await setCadence(t, persona, { repliesPerDay: 2 })
    await listenNow(t, persona)
    const [first, second, third] = (await view(t, persona)).waiting
    if (!first || !second || !third) throw new Error('the sweep left fewer than three drafts')

    await t.mutation(api.private.replies.post, { replyId: first._id, text: ' Cap the retries first. ' })
    expect(await runnerSends(t)).toBe(first._id)
    await t.mutation(api.private.replies.post, { replyId: second._id, text: second.text })
    // X refuses the second one: it stops counting, and the operator can post it again.
    const job = runnerJobSchema.parse(await t.mutation(internal.internal.runner.claimNext, { runnerName: 'test' }))
    await t.mutation(internal.internal.runner.fail, { jobId: job.id as Id<'jobs'>, error: 'X said no' })
    expect((await view(t, persona)).failed.map((reply) => [reply._id, reply.error])).toEqual([[second._id, 'X said no']])
    await t.mutation(api.private.replies.post, { replyId: second._id, text: second.text })
    await runnerSends(t)

    const page = await view(t, persona)
    expect(page.sentToday).toBe(2)
    expect(page.sent.map((reply) => [reply._id, reply.text])).toEqual(
      expect.arrayContaining([
        [first._id, 'Cap the retries first.'],
        [second._id, second.text],
      ])
    )
    await expect(t.mutation(api.private.replies.post, { replyId: third._id, text: third.text })).rejects.toThrow(
      "Ada Automates has sent 2 of 2 replies today. Raise the reply budget in the persona's settings, or post this one tomorrow."
    )
    await expect(t.mutation(api.private.replies.post, { replyId: first._id, text: 'Again' })).rejects.toThrow(
      'This reply is sent; only a reply waiting for you, going out or failed can be posted.'
    )
    await expect(t.mutation(api.private.replies.post, { replyId: third._id, text: 'See https://formstep.io' })).rejects.toThrow(
      'Leave links out of a reply.'
    )

    await t.mutation(api.private.replies.skip, { replyId: third._id })
    expect((await view(t, persona)).skipped.map((reply) => [reply._id, reply.skipReason])).toContainEqual([third._id, 'You passed on it.'])
  })

  it('sends a reply to someone who engaged first on its own, one at a time, when the persona publishes on its own', async () => {
    const t = setup()
    const persona = await t.run((ctx) => insertPersona(ctx))
    await setCadence(t, persona, { repliesPerDay: 5, autoPublish: true })
    await listenNow(t, persona)
    const page = await view(t, persona)
    expect(page.goingOut.map((reply) => [reply.origin, reply.status]).sort()).toEqual([
      ['mention', 'queued'],
      ['reply', 'queued'],
    ])
    // A found post's reply still waits for the operator: X forbids automated replies to posts found by search.
    expect(page.waiting.every((reply) => reply.origin === 'search')).toBe(true)

    expect(await t.mutation(internal.internal.replies.dispatchQueued, {})).toEqual({ dispatched: 1 })
    await runnerSends(t)
    expect(await t.mutation(internal.internal.replies.dispatchQueued, {})).toEqual({ dispatched: 1 })
    await runnerSends(t)
    expect(await t.mutation(internal.internal.replies.dispatchQueued, {})).toEqual({ dispatched: 0 })
    expect((await view(t, persona)).sentToday).toBe(2)
  })

  it('writes the reply the operator asks for on a post naming the sponsor, and measures what sent replies brought back', async () => {
    const t = setup()
    const persona = await t.run((ctx) => insertPersona(ctx))
    if (!sponsorWindow()) vi.setSystemTime(Date.now() + WINDOW_MS)
    await listenNow(t, persona)
    const sponsored = (await view(t, persona)).skipped.find((reply) => reply.target.text.includes('Formstep'))
    if (!sponsored) throw new Error('the sweep heard no post naming the sponsor')

    await t.mutation(api.private.replies.ask, { replyId: sponsored._id })
    await t.finishAllScheduledFunctions(() => {})
    const asked = (await view(t, persona)).waiting.find((reply) => reply._id === sponsored._id)
    expect(asked).toMatchObject({ operatorAsked: true, status: 'draft' })
    expect(asked?.text).toContain('Formstep does that')
    if (!asked) throw new Error('the asked reply is not waiting')

    await t.mutation(api.private.replies.post, { replyId: asked._id, text: asked.text })
    await runnerSends(t)
    await t.mutation(api.private.personas.pullMetrics, { personaId: persona._id })
    await t.finishAllScheduledFunctions(() => {})
    const [sent] = (await view(t, persona)).sent
    expect(sent?.counts?.impressions).toBeGreaterThan(0)

    const report = await t.query(api.private.report.forPersona, { personaId: persona._id })
    expect(report?.engagement).toMatchObject({ sent: 1, measured: 1, impressions: sent?.counts?.impressions, mock: true })
  })
})
