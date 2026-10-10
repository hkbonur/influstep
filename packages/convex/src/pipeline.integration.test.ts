import { runnerJobSchema } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { addDays, dayKey, weekStart } from './core/dates'
import { setup } from '../test/setup'

/**
 * One episode through the whole pipeline with mock providers: seed, writer,
 * approval blocked on a sign-in, checklist done, runner produces, cron
 * dispatches, runner publishes, a viewer clicks, the analyst measures.
 */
describe('episode pipeline', () => {
  it('walks an episode from idea to measured', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, { appUrl: 'http://localhost:3300' })
    await t.finishAllScheduledFunctions(() => {})

    const personas = await t.query(api.private.personas.list, {})
    const ada = personas.find((persona) => persona.handle === 'ada.automates')
    if (!ada) throw new Error('seed has no Ada')

    // The writer wrote the seeded idea of Max and auto-approval blocked on the n8n sign-in.
    const checklist = await t.query(api.private.checklist.list, {})
    const signIn = checklist.find(
      (item) => item.status === 'open' && item.action?.kind === 'open_browser' && item.personaHandle === 'max.builds.agents'
    )
    expect(signIn?.title).toContain('localhost:5678')
    if (!signIn?.episodeId) throw new Error('sign-in item has no episode')
    const blocked = await t.query(api.private.episodes.get, { episodeId: signIn.episodeId })
    expect(blocked?.episode.status).toBe('waiting_on_you')
    expect(blocked?.episode.script.hook.length).toBeGreaterThan(0)

    // Done: the host counts as signed in and the producer starts.
    await t.mutation(api.private.checklist.complete, { itemId: signIn._id })
    const recording = await t.query(api.private.episodes.get, { episodeId: signIn.episodeId })
    expect(recording?.episode.status).toBe('recording')

    // The runner claims the produce job and reports two renders.
    const produceJob = await claimUntil(t, 'produce', signIn.episodeId)
    if (produceJob.kind !== 'produce') throw new Error('expected a produce job')
    expect(produceJob.payload.shots.length).toBeGreaterThan(0)
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['video'])))
    await t.mutation(internal.internal.runner.complete, {
      jobId: produceJob.id as Id<'jobs'>,
      result: {
        renders: [
          { aspect: '16:9', storageId, durationSec: 50, mock: true },
          { aspect: '9:16', storageId, durationSec: 50, mock: true },
        ],
      },
    })
    const scheduled = await t.query(api.private.episodes.get, { episodeId: signIn.episodeId })
    expect(scheduled?.episode.status).toBe('scheduled')
    expect(scheduled?.publications.map((publication) => publication.platform).sort()).toEqual(['tiktok', 'youtube'])
    expect(scheduled?.publications[0]?.description).toContain('/go/')

    // Publish time comes: the cron turns publications into runner jobs.
    const dispatched = await t.mutation(internal.internal.runner.dispatchDuePublications, { now: scheduled!.episode.scheduledAt + 1 })
    expect(dispatched.dispatched).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < 2; i += 1) {
      const job = await claimUntil(t, 'publish', signIn.episodeId)
      if (job.kind !== 'publish') throw new Error('expected a publish job')
      expect(job.payload.renderUrl).toContain('http')
      await t.mutation(internal.internal.runner.complete, {
        jobId: job.id as Id<'jobs'>,
        result: {
          externalId: `ext-${job.payload.platform}`,
          url: `https://${job.payload.platform}.example/ext`,
          publishedAt: Date.now() - 4 * 86_400_000,
          mock: true,
        },
      })
    }
    const published = await t.query(api.private.episodes.get, { episodeId: signIn.episodeId })
    expect(published?.episode.status).toBe('published')

    // A viewer clicks the YouTube link and lands on the sponsor with UTM.
    const link = published!.links.find((candidate) => candidate.platform === 'youtube')!
    const click = await t.mutation(api.public.links.click, { slug: link.slug })
    expect(click?.target).toContain('utm_source=max.builds.agents')
    expect(click?.target).toContain(`utm_campaign=${published!.episode.slug}`)

    // The analyst snapshots, finds conversions, and measures (published four days ago, past the window).
    await t.action(internal.internal.agents.pullMetrics, { personaId: published!.persona._id })
    const measured = await t.query(api.private.episodes.get, { episodeId: signIn.episodeId })
    expect(measured?.episode.status).toBe('measured')
    expect(measured?.snapshots.length).toBe(2)

    const report = await t.query(api.private.report.forPersona, { personaId: published!.persona._id })
    expect(report?.funnel.clicks).toBe(1)
    expect(report?.funnel.views).toBeGreaterThan(0)
    expect(report?.funnel.mock).toBe(true)
  })

  it('reports a funnel and decides the seeded experiment when the data allows', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    await t.finishAllScheduledFunctions(() => {})
    const personas = await t.query(api.private.personas.list, {})
    const ada = personas.find((persona) => persona.handle === 'ada.automates')!
    const report = await t.query(api.private.report.forPersona, { personaId: ada._id })
    expect(report?.funnel.views).toBeGreaterThan(1000)
    expect(report?.funnel.signups).toBeGreaterThan(0)
    expect(report?.episodes.length).toBe(8)
    expect(report?.trend.length).toBe(28)
    const experiments = await t.query(api.private.experiments.list, { personaId: ada._id })
    expect(experiments[0]?.stats.map((stat) => stat.key).sort()).toEqual(['howto', 'wrong'])
    await t.mutation(internal.internal.agents.evaluateExperimentsMutation, { personaId: ada._id })
    const after = await t.query(api.private.experiments.list, { personaId: ada._id })
    expect(['running', 'decided']).toContain(after[0]?.status)
  })

  it('pauses a persona: the runner gets nothing until it resumes', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    await t.finishAllScheduledFunctions(() => {})
    const personas = await t.query(api.private.personas.list, {})
    const ada = personas.find((persona) => persona.handle === 'ada.automates')!
    await t.mutation(api.private.personas.setPaused, { personaId: ada._id, paused: true })
    // The only queued runner job is Ada's produce job from the seed.
    expect(await t.mutation(internal.internal.runner.claimNext, { runnerName: 'test' })).toBeNull()
    await t.mutation(api.private.personas.setPaused, { personaId: ada._id, paused: false })
    expect((await t.mutation(internal.internal.runner.claimNext, { runnerName: 'test' }))?.kind).toBe('produce')
  })

  it('puts a persona discount code into every new description and counts its redemptions', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, { appUrl: 'http://localhost:3300' })
    await t.finishAllScheduledFunctions(() => {})
    const personas = await t.query(api.private.personas.list, {})
    const ada = personas.find((persona) => persona.handle === 'ada.automates')
    if (!ada) throw new Error('seed has no Ada')

    // The seed's conversions are the ones the mock providers report, so the first pull adds nothing.
    const before = await t.query(api.private.report.forPersona, { personaId: ada._id })
    const firstPull = await t.action(internal.internal.agents.pullMetrics, { personaId: ada._id })
    expect(firstPull.conversions).toBe(0)
    expect(firstPull.redemptions).toBe(3)
    const after = await t.query(api.private.report.forPersona, { personaId: ada._id })
    expect(after?.funnel.paid).toBe(before?.funnel.paid)
    expect(after?.funnel.paidViaCode).toBe(3)
    expect(after?.funnel.value).toBe(before?.funnel.value)

    // A Polar discount is one per organization: Max cannot take Ada's code while it is active.
    const max = personas.find((persona) => persona.handle === 'max.builds.agents')
    if (!max) throw new Error('seed has no Max')
    await expect(t.mutation(api.private.personas.giveDiscountCode, { personaId: max._id, code: 'ADA20', offer: 'x' })).rejects.toThrow(
      "ADA20 is already Ada Automates's code"
    )

    // The operator hands Ada a code in her settings. It replaces the seeded ADA20 (same scope), Ada says where it
    // goes, and the queued descriptions of her scheduled episode carry it from now on.
    const offer = '20% off Pro for 3 months'
    const codeId = await t.mutation(api.private.personas.giveDiscountCode, { personaId: ada._id, code: ' ada20 ', offer })
    const page = await t.query(api.private.personas.get, { personaId: ada._id })
    expect(page?.discountCodes.map((code) => code._id)).toEqual([codeId])
    expect(page?.messages.at(-1)?.text).toContain('Code ADA20')
    const newer = await t.mutation(api.private.personas.giveDiscountCode, { personaId: ada._id, code: 'ADA30', offer: '30% off' })
    const queuedEpisode = page?.episodes.find((episode) => episode.status === 'scheduled')
    if (!queuedEpisode) throw new Error('the seed has no scheduled episode for Ada')
    const queued = await t.query(api.private.episodes.get, { episodeId: queuedEpisode._id })
    expect(queued?.publications.map((publication) => publication.status)).toEqual(['queued', 'queued', 'queued'])
    for (const publication of queued?.publications ?? []) {
      expect(publication.description).toContain('Code ADA30: 30% off.')
      expect(publication.description).not.toContain('ADA20')
    }
    expect(queued?.codesInDescriptions).toEqual([{ code: 'ADA30', offer: '30% off' }])
    // Retiring it puts the queued descriptions back to no code; the live ones keep what they shipped with.
    await t.mutation(api.private.personas.retireDiscountCode, { discountCodeId: newer })
    const reverted = await t.query(api.private.episodes.get, { episodeId: queuedEpisode._id })
    expect(reverted?.publications.every((publication) => !publication.description.includes('Code ADA'))).toBe(true)
    expect(reverted?.codesInDescriptions).toEqual([])
    const live = await t.query(api.private.episodes.get, { episodeId: before!.episodes[0]!._id })
    expect(live?.codesInDescriptions).toEqual([{ code: 'ADA20', offer: '20% off Pro for 3 months' }])
    // ADA20 can come back now that nothing else holds it.
    const again = await t.mutation(api.private.personas.giveDiscountCode, { personaId: ada._id, code: 'ADA20', offer })
    // The mock billing provider reports one redemption every nine days since the code was created, and the
    // mutation stamps now. Backdating the row by a month is the only way a test can see redemptions.
    await t.run((ctx) => ctx.db.patch(again, { createdAt: Date.now() - 30 * 86_400_000 }))

    // The writer plans next week (this week is full from the seed) and scripts every idea.
    const nextMonday = addDays(weekStart(dayKey(Date.now(), ada.timezone)), 7)
    await t.mutation(api.private.personas.planWeek, { personaId: ada._id, weekStart: nextMonday })
    await t.finishAllScheduledFunctions(() => {})
    const planned = await t.query(api.private.personas.get, { personaId: ada._id })
    const scripted = planned?.episodes.find((episode) => episode.status === 'scripted' && episode.plannedFor >= nextMonday)
    if (!scripted) throw new Error('the planner left Ada nothing to approve')

    // Approval blocks on the n8n sign-in; done, the producer records.
    await t.mutation(api.private.episodes.approve, { episodeId: scripted._id })
    const checklist = await t.query(api.private.checklist.list, {})
    const signIn = checklist.find((item) => item.status === 'open' && item.episodeId === scripted._id)
    if (!signIn) throw new Error('approval did not block on a sign-in')
    await t.mutation(api.private.checklist.complete, { itemId: signIn._id })
    const produceJob = await claimUntil(t, 'produce', scripted._id)
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['video'])))
    await t.mutation(internal.internal.runner.complete, {
      jobId: produceJob.id as Id<'jobs'>,
      result: {
        renders: [
          { aspect: '16:9', storageId, durationSec: 50, mock: true },
          { aspect: '9:16', storageId, durationSec: 50, mock: true },
        ],
      },
    })

    // Every publication, on every platform, carries the code and the sponsor line.
    const scheduled = await t.query(api.private.episodes.get, { episodeId: scripted._id })
    expect(scheduled?.episode.status).toBe('scheduled')
    expect(scheduled?.publications.length).toBe(3)
    for (const publication of scheduled?.publications ?? []) {
      expect(publication.description).toContain(`Code ADA20: ${offer}.`)
      expect(publication.description).toContain('Formstep collects')
    }
    expect(scheduled?.discountCode).toEqual({ code: 'ADA20', offer })
    expect(scheduled?.currency).toBe('EUR')

    // The analyst polls the code once, hands each order to the row in force when it was placed (the newest
    // row here, backdated to the seed's instant plus a few milliseconds) and keeps the count on that row.
    const pulled = await t.action(internal.internal.agents.pullMetrics, { personaId: ada._id })
    expect(pulled.redemptions).toBe(3)
    expect(pulled.conversions).toBe(0)
    const code = await t.run((ctx) => ctx.db.get(again))
    expect(code?.redemptions).toBe(3)
    const viaCode = await t.run(async (ctx) =>
      (
        await ctx.db
          .query('conversions')
          .withIndex('by_persona_time', (q) => q.eq('personaId', ada._id))
          .collect()
      ).filter((conversion) => conversion.via === 'code' && conversion.distinctId.startsWith('mock-order-ada20'))
    )
    expect(viaCode.length).toBe(3)
    expect(viaCode.every((conversion) => conversion.kind === 'paid' && conversion.episodeId === undefined)).toBe(true)

    // The report shows every ADA20 row: the current one active with its redemptions, the two earlier ones retired.
    const report = await t.query(api.private.report.forPersona, { personaId: ada._id })
    expect(report?.currency).toBe('EUR')
    expect(report?.discountCodes.filter((row) => row.code === 'ADA20').map((row) => row.active)).toEqual([true, false, false])
    expect(report?.discountCodes[0]?.redemptions).toBe(3)
    expect(report?.funnel.paidViaCode).toBe(3)
    expect(report?.funnel.value).toBe(report!.funnel.paid * 29)
    expect(report?.topByValue.length).toBeGreaterThan(0)
    expect(report?.topByValue.length).toBeLessThanOrEqual(5)
  })

  it('turns a chat instruction into a directive the writer reads', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    await t.finishAllScheduledFunctions(() => {})
    const personas = await t.query(api.private.personas.list, {})
    const max = personas.find((persona) => persona.handle === 'max.builds.agents')!
    const sent = await t.mutation(api.private.personas.sendMessage, { personaId: max._id, text: 'Never mention pricing in an episode' })
    expect(sent.directiveId).toBeDefined()
    await t.finishAllScheduledFunctions(() => {})
    const page = await t.query(api.private.personas.get, { personaId: max._id })
    expect(page?.directives.map((directive) => directive.text)).toContain('Never mention pricing in an episode')
    expect(page?.messages.at(-1)?.author).toBe('persona')
  })
})

async function claimUntil(t: ReturnType<typeof setup>, kind: 'produce' | 'publish', episodeId: string) {
  for (let i = 0; i < 10; i += 1) {
    const claimed = await t.mutation(internal.internal.runner.claimNext, { runnerName: 'test' })
    if (!claimed) break
    // The wire type widens the union; the schema narrows it again.
    const job = runnerJobSchema.parse(claimed)
    if (job.kind === kind && (job.kind !== 'produce' || job.payload.episodeId === episodeId)) {
      if (job.kind === 'publish') {
        const publication = await t.run((ctx) => ctx.db.get(job.payload.publicationId as Id<'publications'>))
        if (publication?.episodeId !== episodeId) {
          await t.mutation(internal.internal.runner.fail, { jobId: job.id as Id<'jobs'>, error: 'not the episode under test' })
          continue
        }
      }
      return job
    }
    await t.mutation(internal.internal.runner.fail, { jobId: job.id as Id<'jobs'>, error: 'not the job under test' })
  }
  throw new Error(`no ${kind} job for ${episodeId}`)
}
