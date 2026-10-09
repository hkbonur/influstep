import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { setup } from './test-setup'

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
    const signIn = checklist.find((item) => item.status === 'open' && item.action?.kind === 'open_browser' && item.personaHandle === 'max.builds.agents')
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
    const claimed = await t.mutation(internal.internal.runner.claimNext, { runnerName: 'test' })
    const produceJob = claimed?.kind === 'produce' && claimed.payload.episodeId === signIn.episodeId ? claimed : await claimUntil(t, 'produce', signIn.episodeId)
    expect(produceJob.payload.shots.length).toBeGreaterThan(0)
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['video'])))
    await t.mutation(internal.internal.runner.complete, {
      jobId: produceJob.id as Id<'jobs'>,
      result: { renders: [{ aspect: '16:9', storageId, durationSec: 50, mock: true }, { aspect: '9:16', storageId, durationSec: 50, mock: true }] },
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
      expect(job.payload.renderUrl).toContain('http')
      await t.mutation(internal.internal.runner.complete, {
        jobId: job.id as Id<'jobs'>,
        result: { externalId: `ext-${job.payload.platform}`, url: `https://${job.payload.platform}.example/ext`, publishedAt: Date.now() - 4 * 86_400_000, mock: true },
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
    const job = await t.mutation(internal.internal.runner.claimNext, { runnerName: 'test' })
    if (!job) break
    if (job.kind === kind && (kind === 'publish' || job.payload.episodeId === episodeId)) {
      if (kind === 'publish') {
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
