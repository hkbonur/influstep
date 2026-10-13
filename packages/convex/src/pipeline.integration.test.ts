import { DEFAULT_FORMATS, platformsOpen, runnerJobSchema } from '@influstep/shared'
import type { FunctionReturnType } from 'convex/server'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { addDays, dayKey, instantAt, weekStart } from './core/dates'
import { setup } from '../test/setup'

const TIMEZONE = 'Europe/Oslo'

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

    // Ada posts everywhere, so her videos are one script in the format her platforms resolve to:
    // as short as TikTok asks, delivered the way YouTube asks, with a presenter beat before the screen.
    const page = await t.query(api.private.personas.get, { personaId: ada._id })
    const scripted = page?.episodes.find((episode) => episode.status === 'scripted' && episode.kind === 'video')
    if (!scripted) throw new Error('the seed has no scripted video for Ada')
    expect(scripted.platforms).toEqual(['youtube', 'tiktok', 'instagram', 'x'])
    expect(scripted.format).toEqual({
      lengthSec: 40,
      delivery: 'screen_with_avatar',
      cuts: [
        { platform: 'youtube', aspect: '16:9' },
        { platform: 'tiktok', aspect: '9:16' },
        { platform: 'instagram', aspect: '9:16' },
        { platform: 'x', aspect: '16:9' },
      ],
    })
    expect(scripted.shots.map((shot) => shot.kind)).toEqual(['avatar', 'screen'])

    // Approval blocks on the n8n sign-in the screen shot needs.
    await t.mutation(api.private.episodes.approve, { episodeId: scripted._id })
    const checklist = await t.query(api.private.checklist.list, {})
    const signIn = checklist.find(
      (item) => item.status === 'open' && item.action?.kind === 'open_browser' && item.episodeId === scripted._id
    )
    expect(signIn?.title).toContain('localhost:5678')
    if (!signIn) throw new Error('approval did not block on a sign-in')
    const blocked = await t.query(api.private.episodes.get, { episodeId: scripted._id })
    expect(blocked?.episode.status).toBe('waiting_on_you')
    expect(blocked?.personaPlatforms).toEqual(['youtube', 'tiktok', 'instagram', 'x'])

    // Done: the host counts as signed in and the producer starts.
    await t.mutation(api.private.checklist.complete, { itemId: signIn._id })
    const recording = await t.query(api.private.episodes.get, { episodeId: scripted._id })
    expect(recording?.episode.status).toBe('recording')

    // The runner claims the produce job, one cut per aspect the episode's platforms publish, and reports both.
    const produceJob = await claimUntil(t, 'produce', scripted._id)
    if (produceJob.kind !== 'produce' || produceJob.payload.kind !== 'video') throw new Error('expected a video produce job')
    expect(produceJob.payload.aspects).toEqual(['16:9', '9:16'])
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

    // One publication per platform, each with its platform's cut at its platform's hour; the episode's time is the first.
    const scheduled = await t.query(api.private.episodes.get, { episodeId: scripted._id })
    expect(scheduled?.episode.status).toBe('scheduled')
    const byPlatform = new Map(scheduled?.publications.map((publication) => [publication.platform, publication]))
    expect([...byPlatform.keys()].sort()).toEqual(['instagram', 'tiktok', 'x', 'youtube'])
    expect(byPlatform.get('youtube')?.aspect).toBe('16:9')
    expect(byPlatform.get('tiktok')?.aspect).toBe('9:16')
    expect(byPlatform.get('instagram')?.aspect).toBe('9:16')
    expect(byPlatform.get('x')?.aspect).toBe('16:9')
    expect(byPlatform.get('youtube')?.scheduledAt).toBe(instantAt(scripted.plannedFor, 16, TIMEZONE))
    expect(byPlatform.get('tiktok')?.scheduledAt).toBe(instantAt(scripted.plannedFor, 18, TIMEZONE))
    expect(byPlatform.get('instagram')?.scheduledAt).toBe(instantAt(scripted.plannedFor, 12, TIMEZONE))
    expect(byPlatform.get('x')?.scheduledAt).toBe(instantAt(scripted.plannedFor, 15, TIMEZONE))
    expect(scheduled?.episode.scheduledAt).toBe(instantAt(scripted.plannedFor, 12, TIMEZONE))
    expect(byPlatform.get('youtube')?.description).toContain('/go/')
    // On X the video's text is its title and nothing else: no footer, no link, no code.
    expect(byPlatform.get('x')?.description).toBe(scheduled?.episode.title)
    expect(byPlatform.get('x')?.discountCodeId).toBeUndefined()

    // The last publish time comes: the cron turns every publication into a runner job.
    const lastAt = Math.max(...(scheduled?.publications.map((publication) => publication.scheduledAt) ?? []))
    const dispatched = await t.mutation(internal.internal.runner.dispatchDuePublications, { now: lastAt + 1 })
    expect(dispatched.dispatched).toBeGreaterThanOrEqual(4)
    for (let i = 0; i < 4; i += 1) {
      const job = await claimUntil(t, 'publish', scripted._id)
      if (job.kind !== 'publish' || job.payload.kind !== 'video') throw new Error('expected a video publish job')
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
    const published = await t.query(api.private.episodes.get, { episodeId: scripted._id })
    expect(published?.episode.status).toBe('published')

    // A viewer clicks the YouTube link and lands on the sponsor with UTM.
    const link = published!.links.find((candidate) => candidate.platform === 'youtube')!
    const click = await t.mutation(api.public.links.click, { slug: link.slug })
    expect(click?.target).toContain('utm_source=ada.automates')
    expect(click?.target).toContain(`utm_campaign=${published!.episode.slug}`)

    // The analyst snapshots, finds conversions, and measures (published four days ago, past the window).
    await t.action(internal.internal.agents.pullMetrics, { personaId: ada._id })
    const measured = await t.query(api.private.episodes.get, { episodeId: scripted._id })
    expect(measured?.episode.status).toBe('measured')
    expect(measured?.snapshots.length).toBe(4)

    // The report judges Ada against her own platforms, in PLATFORMS order.
    const report = await t.query(api.private.report.forPersona, { personaId: ada._id })
    expect(report?.funnel.views).toBeGreaterThan(0)
    expect(report?.funnel.mock).toBe(true)
    expect(report?.platforms.map((row) => row.platform)).toEqual(['youtube', 'tiktok', 'instagram', 'x'])
    for (const row of report?.platforms ?? []) {
      expect(row.publications).toBeGreaterThan(0)
      expect(row.views).toBeGreaterThan(0)
    }
    expect(report?.platforms[0]?.clicks).toBeGreaterThan(0)
  })

  it('scripts a TikTok-only talking head to one cut and never waits on a sign-in', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    await t.finishAllScheduledFunctions(() => {})
    const personas = await t.query(api.private.personas.list, {})
    const max = personas.find((persona) => persona.handle === 'max.builds.agents')
    if (!max) throw new Error('seed has no Max')
    expect(max.formats.map((format) => format.platform)).toEqual(['tiktok'])

    // The writer plans next week and scripts every idea; Max auto-approves, and with no screen to record
    // there is no sign-in to wait on, so the producer starts right away.
    const nextMonday = addDays(weekStart(dayKey(Date.now(), max.timezone)), 7)
    await t.mutation(api.private.personas.planWeek, { personaId: max._id, weekStart: nextMonday })
    await t.finishAllScheduledFunctions(() => {})
    const page = await t.query(api.private.personas.get, { personaId: max._id })
    const episode = page?.episodes.find((candidate) => candidate.plannedFor >= nextMonday)
    if (!episode) throw new Error('the planner left Max nothing')
    expect(episode.status).toBe('recording')
    expect(episode.platforms).toEqual(['tiktok'])
    expect(episode.format).toEqual({ lengthSec: 35, delivery: 'talking_head', cuts: [{ platform: 'tiktok', aspect: '9:16' }] })
    expect(episode.shots.length).toBeGreaterThan(0)
    expect(episode.shots.every((shot) => shot.kind === 'avatar')).toBe(true)
    expect(episode.script.body.split(/\s+/).length).toBeGreaterThan(40)
    const checklist = await t.query(api.private.checklist.list, {})
    expect(checklist.filter((item) => item.episodeId === episode._id)).toEqual([])

    // One vertical cut, one publication, at TikTok's hour.
    const produceJob = await claimUntil(t, 'produce', episode._id)
    if (produceJob.kind !== 'produce' || produceJob.payload.kind !== 'video') throw new Error('expected a video produce job')
    expect(produceJob.payload.aspects).toEqual(['9:16'])
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['video'])))
    await t.mutation(internal.internal.runner.complete, {
      jobId: produceJob.id as Id<'jobs'>,
      result: { renders: [{ aspect: '9:16', storageId, durationSec: 35, mock: true }] },
    })
    const scheduled = await t.query(api.private.episodes.get, { episodeId: episode._id })
    expect(scheduled?.episode.status).toBe('scheduled')
    expect(scheduled?.publications.length).toBe(1)
    const [publication] = scheduled?.publications ?? []
    expect(publication?.platform).toBe('tiktok')
    expect(publication?.aspect).toBe('9:16')
    expect(publication?.scheduledAt).toBe(instantAt(episode.plannedFor, 17, TIMEZONE))
    expect(scheduled?.episode.scheduledAt).toBe(publication?.scheduledAt)
  })

  it('narrows where a scripted episode goes and derives its format and shots again', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    const personas = await t.query(api.private.personas.list, {})
    const max = personas.find((persona) => persona.handle === 'max.builds.agents')
    const ada = personas.find((persona) => persona.handle === 'ada.automates')
    if (!max || !ada) throw new Error('seed has no personas')

    // Before the writer runs, Max's seeded episodes are ideas: a platform he lacks is refused by name, and so is nothing.
    const maxPage = await t.query(api.private.personas.get, { personaId: max._id })
    const idea = maxPage?.episodes.find((candidate) => candidate.status === 'idea')
    if (!idea) throw new Error('the seed has no idea for Max')
    await expect(t.mutation(api.private.episodes.setPlatforms, { episodeId: idea._id, platforms: ['youtube'] })).rejects.toThrow(
      'does not publish on YouTube'
    )
    await expect(t.mutation(api.private.episodes.setPlatforms, { episodeId: idea._id, platforms: [] })).rejects.toThrow(
      'at least one platform'
    )
    await t.finishAllScheduledFunctions(() => {})

    // Ada's scripted episode, narrowed to TikTok: the short talking-head format at TikTok's hour, every shot a take.
    const adaPage = await t.query(api.private.personas.get, { personaId: ada._id })
    const scripted = adaPage?.episodes.find((candidate) => candidate.status === 'scripted' && candidate.kind === 'video')
    if (!scripted) throw new Error('the seed has no scripted video for Ada')
    await t.mutation(api.private.episodes.setPlatforms, { episodeId: scripted._id, platforms: ['tiktok'] })
    const narrowed = await t.query(api.private.episodes.get, { episodeId: scripted._id })
    expect(narrowed?.episode.platforms).toEqual(['tiktok'])
    expect(narrowed?.episode.format).toEqual({ lengthSec: 40, delivery: 'talking_head', cuts: [{ platform: 'tiktok', aspect: '9:16' }] })
    expect(narrowed?.episode.scheduledAt).toBe(instantAt(scripted.plannedFor, 18, TIMEZONE))
    expect(narrowed?.episode.shots.length).toBe(scripted.shots.length)
    expect(narrowed?.episode.shots.every((shot) => shot.kind === 'avatar')).toBe(true)
    expect(narrowed?.episode.hook).toBe(scripted.hook)

    // Widened back, the screen returns, and approval records straight away once the host is signed in.
    await t.mutation(api.private.episodes.setPlatforms, { episodeId: scripted._id, platforms: ['tiktok', 'youtube'] })
    const widened = await t.query(api.private.episodes.get, { episodeId: scripted._id })
    expect(widened?.episode.platforms).toEqual(['youtube', 'tiktok'])
    expect(widened?.episode.format).toEqual({
      lengthSec: 40,
      delivery: 'screen_with_avatar',
      cuts: [
        { platform: 'youtube', aspect: '16:9' },
        { platform: 'tiktok', aspect: '9:16' },
      ],
    })
    expect(widened?.episode.scheduledAt).toBe(instantAt(scripted.plannedFor, 16, TIMEZONE))
    expect(widened?.episode.shots.map((shot) => shot.kind)).toEqual(['avatar', 'screen'])

    // A recording episode is locked.
    const recording = adaPage?.episodes.find((candidate) => candidate.status === 'recording')
    if (!recording) throw new Error('the seed has no recording episode for Ada')
    await expect(t.mutation(api.private.episodes.setPlatforms, { episodeId: recording._id, platforms: ['tiktok'] })).rejects.toThrow(
      'is at "Recording"'
    )

    // Moving the episode keeps each platform at its own hour on the new day.
    const scheduledEpisode = adaPage?.episodes.find((candidate) => candidate.status === 'scheduled' && candidate.kind === 'video')
    if (!scheduledEpisode) throw new Error('the seed has no scheduled video for Ada')
    const newDay = addDays(scheduledEpisode.plannedFor, 7)
    await t.mutation(api.private.episodes.reschedule, { episodeId: scheduledEpisode._id, plannedFor: newDay })
    const moved = await t.query(api.private.episodes.get, { episodeId: scheduledEpisode._id })
    expect(moved?.episode.scheduledAt).toBe(instantAt(newDay, 12, TIMEZONE))
    expect(moved?.publications.find((publication) => publication.platform === 'tiktok')?.scheduledAt).toBe(instantAt(newDay, 18, TIMEZONE))

    // The calendar card carries where the episode goes, not where the persona could.
    const week = await t.query(api.private.calendar.week, { weekStart: weekStart(scripted.plannedFor), personaId: ada._id })
    const card = week.days.flatMap((day) => day.episodes).find((candidate) => candidate._id === scripted._id)
    expect(card?.platforms).toEqual(['youtube', 'tiktok'])
  })

  it('takes a dropped platform out of open episodes and keeps the cuts an episode was scripted to', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    await t.finishAllScheduledFunctions(() => {})
    const personas = await t.query(api.private.personas.list, {})
    const ada = personas.find((persona) => persona.handle === 'ada.automates')
    if (!ada) throw new Error('seed has no Ada')
    const settings = settingsOf(ada)
    const without = (platform: string) => settings.formats.filter((format) => format.platform !== platform)

    // The seed leaves Ada episodes mid-pipeline on every platform, so dropping Instagram is refused by name.
    await expect(t.mutation(api.private.personas.update, { ...settings, formats: without('instagram') })).rejects.toThrow(
      /^".+" is at ".+" with Instagram in its cuts\. Kill it, or remove Instagram once it is published\.$/
    )
    const page = await t.query(api.private.personas.get, { personaId: ada._id })
    for (const episode of page?.episodes ?? []) {
      if (platformsOpen(episode.status) || episode.status === 'published' || episode.status === 'measured') continue
      await t.mutation(api.private.episodes.kill, { episodeId: episode._id })
    }
    const scripted = page?.episodes.find((episode) => episode.status === 'scripted' && episode.kind === 'video')
    if (!scripted) throw new Error('the seed has no scripted video for Ada')

    // An episode that goes only to the dropped platform cannot be narrowed to nothing.
    await t.mutation(api.private.episodes.setPlatforms, { episodeId: scripted._id, platforms: ['instagram'] })
    await expect(t.mutation(api.private.personas.update, { ...settings, formats: without('instagram') })).rejects.toThrow(
      `"${scripted.title}" goes only to Instagram. Kill it, or keep Instagram.`
    )
    await t.mutation(api.private.episodes.setPlatforms, { episodeId: scripted._id, platforms: ['youtube', 'tiktok', 'instagram', 'x'] })

    // With nothing in the way, the drop narrows the scripted episode: the format and the publish time follow.
    await t.mutation(api.private.personas.update, { ...settings, formats: without('instagram') })
    const narrowed = await t.query(api.private.episodes.get, { episodeId: scripted._id })
    expect(narrowed?.episode.platforms).toEqual(['youtube', 'tiktok', 'x'])
    expect(narrowed?.episode.format).toEqual({
      lengthSec: 40,
      delivery: 'screen_with_avatar',
      cuts: [
        { platform: 'youtube', aspect: '16:9' },
        { platform: 'tiktok', aspect: '9:16' },
        { platform: 'x', aspect: '16:9' },
      ],
    })
    expect(narrowed?.episode.scheduledAt).toBe(instantAt(scripted.plannedFor, 15, TIMEZONE))
    expect(narrowed?.personaPlatforms).toEqual(['youtube', 'tiktok', 'x'])
    const chat = await t.query(api.private.personas.get, { personaId: ada._id })
    expect(chat?.messages.at(-1)?.text).toContain(`"${scripted.title}" now goes to YouTube, TikTok, X.`)
    const live = page?.episodes.find(
      (episode) => episode.kind === 'video' && (episode.status === 'published' || episode.status === 'measured')
    )
    if (!live) throw new Error('the seed has no live video for Ada')
    expect((await t.query(api.private.episodes.get, { episodeId: live._id }))?.episode.platforms).toEqual([
      'youtube',
      'tiktok',
      'instagram',
      'x',
    ])

    // Ada's TikTok turns wide after the script was written: the episode still ships the vertical cut it was scripted to.
    const wideTiktok = without('instagram').map((format) =>
      format.platform === 'tiktok' ? { ...format, aspect: '16:9' as const } : format
    )
    await t.mutation(api.private.personas.update, { ...settings, formats: wideTiktok })
    await t.mutation(api.private.episodes.approve, { episodeId: scripted._id })
    const checklist = await t.query(api.private.checklist.list, {})
    const signIn = checklist.find((item) => item.status === 'open' && item.episodeId === scripted._id)
    if (!signIn) throw new Error('approval did not block on a sign-in')
    await t.mutation(api.private.checklist.complete, { itemId: signIn._id })
    const produceJob = await claimUntil(t, 'produce', scripted._id)
    if (produceJob.kind !== 'produce' || produceJob.payload.kind !== 'video') throw new Error('expected a video produce job')
    expect(produceJob.payload.aspects).toEqual(['16:9', '9:16'])
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['video'])))
    await t.mutation(internal.internal.runner.complete, {
      jobId: produceJob.id as Id<'jobs'>,
      result: {
        renders: [
          { aspect: '16:9', storageId, durationSec: 40, mock: true },
          { aspect: '9:16', storageId, durationSec: 40, mock: true },
        ],
      },
    })
    const scheduled = await t.query(api.private.episodes.get, { episodeId: scripted._id })
    expect(scheduled?.episode.status).toBe('scheduled')
    expect(scheduled?.publications.map((publication) => [publication.platform, publication.aspect]).sort()).toEqual([
      ['tiktok', '9:16'],
      ['x', '16:9'],
      ['youtube', '16:9'],
    ])

    // Scheduled, it holds TikTok: the platform cannot leave the persona until the episode is through.
    await expect(
      t.mutation(api.private.personas.update, {
        ...settings,
        formats: without('instagram').filter((format) => format.platform !== 'tiktok'),
      })
    ).rejects.toThrow(`"${scripted.title}" is at "Scheduled" with TikTok in its cuts. Kill it, or remove TikTok once it is published.`)
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
    // Eight videos went everywhere; the thread went live on X two days ago and counts like an episode.
    expect(report?.episodes.length).toBe(9)
    expect(report?.trend.length).toBe(28)
    expect(report?.platforms.map((row) => [row.platform, row.publications])).toEqual([
      ['youtube', 8],
      ['tiktok', 8],
      ['instagram', 8],
      ['x', 9],
    ])
    const experiments = await t.query(api.private.experiments.list, { personaId: ada._id })
    expect(experiments[0]?.stats.map((stat) => stat.key).sort()).toEqual(['howto', 'wrong'])
    await t.mutation(internal.internal.agents.evaluateExperimentsMutation, { personaId: ada._id })
    const after = await t.query(api.private.experiments.list, { personaId: ada._id })
    expect(['running', 'decided']).toContain(after[0]?.status)
  })

  it('shows a persona as working while one of its jobs is queued or running', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    await t.finishAllScheduledFunctions(() => {})
    const seeded = await t.query(api.private.personas.list, {})
    // Ada's seeded produce job waits for the runner.
    expect(seeded.find((persona) => persona.handle === 'ada.automates')?.working).toBe(true)

    // A new persona queues its first signal poll on the backend, and is idle once the poll is done.
    const personaId = await t.mutation(api.private.personas.create, {
      name: 'Iris Ships',
      color: 'iris',
      handle: 'iris.ships',
      niche: 'shipping small SaaS products',
      tone: 'plain',
      bio: 'One shipped feature a week.',
      bible: 'Iris shows the change before she names it.',
      pillars: ['Shipping'],
      formats: [{ platform: 'tiktok', ...DEFAULT_FORMATS.tiktok }],
      voiceId: 'mock-iris',
      sponsorDial: 0.3,
      sponsorRampEpisodes: 10,
      episodesPerWeek: 3,
      autoApprove: false,
      timezone: TIMEZONE,
    })
    const queued = await t.query(api.private.personas.list, {})
    expect(queued.find((persona) => persona._id === personaId)).toMatchObject({ color: 'iris', working: true })
    await t.finishAllScheduledFunctions(() => {})
    const idle = await t.query(api.private.personas.list, {})
    expect(idle.find((persona) => persona._id === personaId)?.working).toBe(false)
  })

  it('keeps the persona page working while its queued job sits behind a dozen newer ones', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    await t.finishAllScheduledFunctions(() => {})
    const ada = (await t.query(api.private.personas.list, {})).find((persona) => persona.handle === 'ada.automates')
    if (!ada) throw new Error('seed has no Ada')

    // The runner stays offline, so her produce job waits while hourly polls pile up after it.
    for (let poll = 0; poll < 12; poll++) await t.mutation(api.private.personas.pollSignals, { personaId: ada._id })
    await t.finishAllScheduledFunctions(() => {})

    const page = await t.query(api.private.personas.get, { personaId: ada._id })
    expect(page?.jobs.some((job) => job.kind === 'produce')).toBe(false)
    expect(page?.working).toBe(true)
    const roster = await t.query(api.private.personas.list, {})
    expect(roster.find((persona) => persona._id === ada._id)?.working).toBe(true)
  })

  it('pauses a persona: the runner gets nothing until it resumes', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    await t.finishAllScheduledFunctions(() => {})
    const personas = await t.query(api.private.personas.list, {})
    const ada = personas.find((persona) => persona.handle === 'ada.automates')!
    const max = personas.find((persona) => persona.handle === 'max.builds.agents')!
    // Both personas have produce jobs waiting: Ada's from the seed, Max's from his auto-approved scripts.
    await t.mutation(api.private.personas.setPaused, { personaId: ada._id, paused: true })
    await t.mutation(api.private.personas.setPaused, { personaId: max._id, paused: true })
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
    const queuedEpisode = page?.episodes.find((episode) => episode.status === 'scheduled' && episode.kind === 'video')
    if (!queuedEpisode) throw new Error('the seed has no scheduled video for Ada')
    const queued = await t.query(api.private.episodes.get, { episodeId: queuedEpisode._id })
    expect(queued?.publications.map((publication) => publication.status)).toEqual(['queued', 'queued', 'queued', 'queued'])
    for (const publication of queued?.publications ?? []) {
      // X carries the title alone, so a code never reaches it.
      if (publication.platform === 'x') {
        expect(publication.description).toBe(queuedEpisode.title)
        continue
      }
      expect(publication.description).toContain('Code ADA30: 30% off.')
      expect(publication.description).not.toContain('ADA20')
    }
    expect(queued?.codesInDescriptions).toEqual([{ code: 'ADA30', offer: '30% off' }])
    // Retiring it puts the queued descriptions back to no code; the live ones keep what they shipped with.
    await t.mutation(api.private.personas.retireDiscountCode, { discountCodeId: newer })
    const reverted = await t.query(api.private.episodes.get, { episodeId: queuedEpisode._id })
    expect(reverted?.publications.every((publication) => publication.description?.includes('Code ADA') === false)).toBe(true)
    expect(reverted?.codesInDescriptions).toEqual([])
    const liveVideo = page?.episodes.find(
      (episode) => episode.kind === 'video' && (episode.status === 'published' || episode.status === 'measured')
    )
    if (!liveVideo) throw new Error('the seed has no live video for Ada')
    const live = await t.query(api.private.episodes.get, { episodeId: liveVideo._id })
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
    const scripted = planned?.episodes.find(
      (episode) => episode.status === 'scripted' && episode.kind === 'video' && episode.plannedFor >= nextMonday
    )
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

    // Every publication off X carries the code and the sponsor line; X carries the title alone.
    const scheduled = await t.query(api.private.episodes.get, { episodeId: scripted._id })
    expect(scheduled?.episode.status).toBe('scheduled')
    expect(scheduled?.publications.length).toBe(4)
    for (const publication of scheduled?.publications ?? []) {
      if (publication.platform === 'x') {
        expect(publication.description).toBe(scheduled?.episode.title)
        continue
      }
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

/**
 * Posts on X: the data rules. The writer, the planner and the runner's post
 * payloads have their own tests (posts.integration.test.ts).
 */
describe('posts on X', () => {
  it('schedules an approved text post at once, as written, with nothing to produce', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const page = await t.query(api.private.personas.get, { personaId: ada._id })
    const text = page?.episodes.find((episode) => episode.kind === 'text' && episode.status === 'scripted')
    if (!text?.post) throw new Error('the seed has no written text post for Ada')
    expect(text.platforms).toEqual(['x'])
    expect(text.hook).toBe('n8n retries a failed node three times by default.')

    // The calendar draws a post by its kind and first line.
    const week = await t.query(api.private.calendar.week, { weekStart: weekStart(text.plannedFor), personaId: ada._id })
    const card = week.days.flatMap((day) => day.episodes).find((candidate) => candidate._id === text._id)
    expect(card).toMatchObject({ kind: 'text', hook: text.hook })

    await t.mutation(api.private.episodes.approve, { episodeId: text._id })
    const scheduled = await t.query(api.private.episodes.get, { episodeId: text._id })
    expect(scheduled?.episode.status).toBe('scheduled')
    expect(scheduled?.publications.length).toBe(1)
    const [publication] = scheduled?.publications ?? []
    expect(publication).toMatchObject({ platform: 'x', status: 'queued', parts: text.post.parts, scheduledAt: text.scheduledAt })
    expect(publication?.aspect).toBeUndefined()
    expect(publication?.description).toBeUndefined()
    expect(publication?.discountCodeId).toBeUndefined()
    expect(scheduled?.jobs.filter((job) => job.kind === 'produce')).toEqual([])
    expect(scheduled?.checklist).toEqual([])

    // It failed on X: the operator rewrites it, the queued publication takes the new words, and a retry sends it again.
    if (!publication) throw new Error('approval made no publication')
    await t.run(async (ctx) => {
      await ctx.db.patch(publication._id, { status: 'failed', error: 'X said no' })
      await ctx.db.patch(text._id, { status: 'failed' })
    })
    const rewritten = { parts: ['n8n retries a failed node three times. Turn it off on anything that moves money.'] }
    await t.mutation(api.private.episodes.updatePost, { episodeId: text._id, title: 'Retries and money', post: rewritten })
    await t.mutation(api.private.episodes.retry, { episodeId: text._id })
    const retried = await t.query(api.private.episodes.get, { episodeId: text._id })
    expect(retried?.episode.status).toBe('scheduled')
    expect(retried?.episode.hook).toBe(rewritten.parts[0])
    expect(retried?.publications.map((row) => [row.status, row.title, row.parts])).toEqual([
      ['queued', 'Retries and money', rewritten.parts],
    ])

    // It failed again and went back through the writer: approving the new draft queues the same publication again.
    const again = { parts: ['Turn off retries on any n8n node that moves money.'] }
    await t.run(async (ctx) => {
      await ctx.db.patch(publication._id, { status: 'failed', error: 'X said no again' })
      await ctx.db.patch(text._id, { status: 'scripted', post: again })
    })
    await t.mutation(api.private.episodes.approve, { episodeId: text._id })
    const reapproved = await t.query(api.private.episodes.get, { episodeId: text._id })
    expect(reapproved?.publications.map((row) => [row.status, row.parts, row.error])).toEqual([['queued', again.parts, undefined]])
  })

  it('renders an approved image post first, then schedules its card on X', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const post = { parts: ['An error workflow catches what every other node misses.'], cardTitle: 'Catch every failure' }
    const episodeId = await insertPost(t, ada, { kind: 'image', status: 'scripted', hour: 18, post })

    await t.mutation(api.private.episodes.approve, { episodeId })
    expect((await t.query(api.private.episodes.get, { episodeId }))?.episode.status).toBe('recording')
    const produceJob = await claimUntil(t, 'produce', episodeId)
    if (produceJob.kind !== 'produce') throw new Error('expected a produce job')
    expect(produceJob.payload).toEqual({
      kind: 'image',
      episodeId,
      cardTitle: 'Catch every failure',
      personaName: ada.name,
      handle: ada.handle,
    })
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['card'])))
    await t.mutation(internal.internal.runner.complete, {
      jobId: produceJob.id as Id<'jobs'>,
      result: { renders: [{ aspect: '16:9', storageId, durationSec: 0, mock: true }] },
    })

    const scheduled = await t.query(api.private.episodes.get, { episodeId })
    expect(scheduled?.episode.status).toBe('scheduled')
    expect(scheduled?.episode.renders.map((render) => [render.aspect, render.durationSec])).toEqual([['16:9', 0]])
    expect(scheduled?.publications.length).toBe(1)
    expect(scheduled?.publications[0]).toMatchObject({ platform: 'x', aspect: '16:9', status: 'queued', parts: post.parts, mock: true })
    expect(scheduled?.publications[0]?.description).toBeUndefined()

    // Moved to another day, the post and its publication keep the slot's hour.
    const newDay = addDays(scheduled!.episode.plannedFor, 7)
    await t.mutation(api.private.episodes.reschedule, { episodeId, plannedFor: newDay })
    const moved = await t.query(api.private.episodes.get, { episodeId })
    expect(moved?.episode.scheduledAt).toBe(instantAt(newDay, 18, TIMEZONE))
    expect(moved?.publications[0]?.scheduledAt).toBe(instantAt(newDay, 18, TIMEZONE))
  })

  it('keeps a rendered card title until a rewrite drops the card', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const post = { parts: ['An error workflow catches what every other node misses.'], cardTitle: 'Catch every failure' }
    const episodeId = await insertPost(t, ada, { kind: 'image', status: 'scripted', hour: 18, post })
    await t.mutation(api.private.episodes.approve, { episodeId })
    const produceJob = await claimUntil(t, 'produce', episodeId)
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['card'])))
    await t.mutation(internal.internal.runner.complete, {
      jobId: produceJob.id as Id<'jobs'>,
      result: { renders: [{ aspect: '16:9', storageId, durationSec: 0, mock: true }] },
    })
    const [publication] = (await t.query(api.private.episodes.get, { episodeId }))?.publications ?? []
    if (!publication) throw new Error('the rendered card made no publication')

    // Its publish failed. A retry sends the card already rendered, so the card title holds while the words still change.
    await t.run(async (ctx) => {
      await ctx.db.patch(publication._id, { status: 'failed', error: 'X said no' })
      await ctx.db.patch(episodeId, { status: 'failed' })
    })
    const updatePost = (next: { parts: string[]; cardTitle: string }) =>
      t.mutation(api.private.episodes.updatePost, { episodeId, title: 'An image post', post: next })
    await expect(updatePost({ ...post, cardTitle: 'Catch them all' })).rejects.toThrow(
      'The card is already rendered; rewrite the post to change it.'
    )
    await updatePost({ ...post, parts: ['Every workflow deserves an error workflow.'] })
    const failed = await t.query(api.private.episodes.get, { episodeId })
    expect(failed?.episode.post).toEqual({ parts: ['Every workflow deserves an error workflow.'], cardTitle: 'Catch every failure' })

    // A rewrite drops the card, so the post it gets may carry a new card title, rendered on approval.
    await t.mutation(api.private.episodes.rewrite, { episodeId })
    const rewritten = await t.query(api.private.episodes.get, { episodeId })
    expect(rewritten?.episode.status).toBe('idea')
    expect(rewritten?.episode.renders).toEqual([])
    await updatePost({ ...post, cardTitle: 'Catch them all' })
    expect((await t.query(api.private.episodes.get, { episodeId }))?.episode.post?.cardTitle).toBe('Catch them all')
  })

  it('refuses a video title X would not take when the script is edited after approval', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const video = (await t.query(api.private.personas.get, { personaId: ada._id }))?.episodes.find(
      (episode) => episode.kind === 'video' && episode.status === 'scripted'
    )
    if (!video) throw new Error('the seed has no scripted video for Ada')
    // Waiting on a sign-in, the script still takes edits, and production starts without approval checking the title again.
    await t.run((ctx) => ctx.db.patch(video._id, { status: 'waiting_on_you', platforms: ['youtube', 'x'] }))
    const updateScript = (title: string) =>
      t.mutation(api.private.episodes.updateScript, { episodeId: video._id, title, script: video.script })
    await expect(updateScript('a'.repeat(281))).rejects.toThrow('The title is 281 characters; X allows 280.')
    await updateScript('a'.repeat(280))

    // The limit is X's: a video that does not go to X is not held to it.
    await t.run((ctx) => ctx.db.patch(video._id, { platforms: ['youtube'] }))
    await updateScript('a'.repeat(281))
  })

  it('refuses a post X would not take, and the video-only edits on a post', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const episodeId = await insertPost(t, ada, { kind: 'thread', status: 'scripted', hour: 15 })

    await expect(t.mutation(api.private.episodes.approve, { episodeId })).rejects.toThrow('The post is not written yet.')
    const updatePost = (parts: string[]) => t.mutation(api.private.episodes.updatePost, { episodeId, title: 'A thread', post: { parts } })
    await expect(updatePost(['Fine.', 'b'.repeat(281)])).rejects.toThrow('Part 2 is 281 characters; X allows 280.')
    // X weighs a link 23 whatever its length.
    await expect(updatePost(['Fine.', `${'b'.repeat(257)} https://formstep.io/a/long/path`])).rejects.toThrow(
      'Part 2 is 281 characters; X allows 280.'
    )
    await expect(updatePost(['Only one part.'])).rejects.toThrow('A thread is 2 to 6 parts.')
    await updatePost(['First.\nMore of the first.', `${'b'.repeat(256)} https://formstep.io/a/long/path`])
    const saved = await t.query(api.private.episodes.get, { episodeId })
    expect(saved?.episode.hook).toBe('First.')
    expect(saved?.episode.post?.parts.length).toBe(2)

    await expect(t.mutation(api.private.episodes.setPlatforms, { episodeId, platforms: ['x', 'youtube'] })).rejects.toThrow(
      'A post goes only to X.'
    )
    await expect(
      t.mutation(api.private.episodes.updateScript, {
        episodeId,
        title: 'A thread',
        script: { hook: 'h', body: 'b', sponsor: '', cta: '' },
      })
    ).rejects.toThrow('A post has no script; edit the post instead.')
    const video = (await t.query(api.private.personas.get, { personaId: ada._id }))?.episodes.find(
      (episode) => episode.kind === 'video' && episode.status === 'scripted'
    )
    if (!video) throw new Error('the seed has no scripted video for Ada')
    await expect(updatePostOn(t, video._id)).rejects.toThrow('A video has a script, not a post.')
  })

  it('checks the X cadence wherever formats are saved', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const x = { platform: 'x' as const, ...DEFAULT_FORMATS.x }
    const tiktok = { platform: 'tiktok' as const, ...DEFAULT_FORMATS.tiktok }
    const create = (formats: (typeof x | typeof tiktok)[]) => t.mutation(api.private.personas.create, { ...newPersona, formats })
    const { cadence, ...withoutCadence } = x
    if (!cadence) throw new Error('the X default has no cadence')

    await expect(create([withoutCadence])).rejects.toThrow('X needs a post cadence.')
    await expect(create([{ ...tiktok, cadence }])).rejects.toThrow('TikTok has no post cadence; only X does.')
    await expect(create([{ ...x, cadence: { ...cadence, postsPerDay: 5 } }])).rejects.toThrow('X: posts per day is 1 to 4.')
    await expect(create([{ ...x, cadence: { ...cadence, postsPerDay: 0 } }])).rejects.toThrow('X: posts per day is 1 to 4.')
    await expect(create([{ ...x, cadence: { ...cadence, postsPerDay: 1.5 } }])).rejects.toThrow('X: posts per day is 1 to 4.')
    await expect(create([{ ...x, cadence: { ...cadence, kinds: [] } }])).rejects.toThrow('X: pick at least one post kind.')
    await expect(create([{ ...x, cadence: { ...cadence, kinds: ['text', 'thread', 'text'] } }])).rejects.toThrow(
      'X: Text post is picked twice.'
    )
    const settings = settingsOf(ada)
    await expect(
      t.mutation(api.private.personas.update, {
        ...settings,
        formats: settings.formats.map((format) =>
          format.platform === 'x' ? { ...format, cadence: { ...cadence, postsPerDay: 9 } } : format
        ),
      })
    ).rejects.toThrow('X: posts per day is 1 to 4.')
  })

  it('opens the X checklist once per persona, when it gains X', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    const xItems = async (personaId: Id<'personas'>) =>
      (
        await t.run((ctx) =>
          ctx.db
            .query('checklistItems')
            .filter((q) => q.eq(q.field('personaId'), personaId))
            .collect()
        )
      )
        .filter((item) => item.action?.kind === 'visit' || item.action?.kind === 'set_provider_key')
        .map((item) => [item.title, item.status, item.action])

    // Created with X: both items at once.
    const withX = await t.mutation(api.private.personas.create, { ...newPersona, formats: [{ platform: 'x', ...DEFAULT_FORMATS.x }] })
    expect(await xItems(withX)).toEqual([
      [
        "Turn on X's automated account label for @iris.ships",
        'open',
        { kind: 'visit', url: 'https://help.x.com/en/using-x/automated-account-labels' },
      ],
      ['Connect an X account for Iris Ships', 'open', { kind: 'set_provider_key', key: 'X_OAUTH' }],
    ])

    // Created without X: nothing, until an update adds it. Saving again, or dropping X and adding it back, opens nothing new.
    const personaId = await t.mutation(api.private.personas.create, {
      ...newPersona,
      handle: 'nils.ships',
      name: 'Nils Ships',
      formats: [{ platform: 'tiktok', ...DEFAULT_FORMATS.tiktok }],
    })
    expect(await xItems(personaId)).toEqual([])
    const persona = (await t.query(api.private.personas.list, {})).find((candidate) => candidate._id === personaId)
    if (!persona) throw new Error('persona not listed')
    const tiktokOnly = settingsOf(persona)
    const withXToo = { ...tiktokOnly, formats: [...tiktokOnly.formats, { platform: 'x' as const, ...DEFAULT_FORMATS.x }] }
    await t.mutation(api.private.personas.update, withXToo)
    const opened = await xItems(personaId)
    expect(opened.map(([title]) => title)).toEqual([
      "Turn on X's automated account label for @nils.ships",
      'Connect an X account for Nils Ships',
    ])
    await t.mutation(api.private.personas.update, withXToo)
    expect(await xItems(personaId)).toEqual(opened)

    // The operator turned the label on; dropping X and adding it back does not ask again.
    const label = (await t.query(api.private.checklist.list, {})).find(
      (item) => item.personaId === personaId && item.action?.kind === 'visit'
    )
    if (!label) throw new Error('no label item')
    await expect(t.mutation(api.private.checklist.runAction, { itemId: label._id })).rejects.toThrow(
      'This page opens in your own browser; the runner has nothing to do for it.'
    )
    await t.mutation(api.private.checklist.complete, { itemId: label._id })
    await t.mutation(api.private.personas.update, tiktokOnly)
    await t.mutation(api.private.personas.update, withXToo)
    expect((await xItems(personaId)).map(([, status]) => status)).toEqual(['done', 'open'])
  })
})

/** A persona the tests create, before its formats. */
const newPersona = {
  name: 'Iris Ships',
  color: 'iris' as const,
  handle: 'iris.ships',
  niche: 'shipping small SaaS products',
  tone: 'plain',
  bio: 'One shipped feature a week.',
  bible: 'Iris shows the change before she names it.',
  pillars: ['Shipping'],
  voiceId: 'mock-iris',
  sponsorDial: 0.3,
  sponsorRampEpisodes: 10,
  episodesPerWeek: 3,
  autoApprove: false,
  timezone: TIMEZONE,
}

async function seededAda(t: ReturnType<typeof setup>) {
  const ada = (await t.query(api.private.personas.list, {})).find((persona) => persona.handle === 'ada.automates')
  if (!ada) throw new Error('seed has no Ada')
  return ada
}

/** A post for Ada a week out, at one of her slots, as the writer would leave it. */
async function insertPost(
  t: ReturnType<typeof setup>,
  ada: { _id: Id<'personas'> },
  args: { kind: 'text' | 'image' | 'thread'; status: 'idea' | 'scripted'; hour: number; post?: { parts: string[]; cardTitle?: string } }
): Promise<Id<'episodes'>> {
  const plannedFor = addDays(dayKey(Date.now(), TIMEZONE), 7)
  const now = Date.now()
  return t.run((ctx) =>
    ctx.db.insert('episodes', {
      personaId: ada._id,
      slug: `test-${args.kind}`,
      kind: args.kind,
      status: args.status,
      concept: `A ${args.kind} post`,
      title: `A ${args.kind} post`,
      hook: args.post?.parts[0] ?? '',
      script: { hook: '', body: '', sponsor: '', cta: '' },
      post: args.post,
      sponsorSegment: 'none',
      platforms: ['x'],
      shots: [],
      renders: [],
      plannedFor,
      scheduledAt: instantAt(plannedFor, args.hour, TIMEZONE),
      signalIds: [],
      createdAt: now,
      updatedAt: now,
    })
  )
}

function updatePostOn(t: ReturnType<typeof setup>, episodeId: Id<'episodes'>) {
  return t.mutation(api.private.episodes.updatePost, { episodeId, title: 'Not a post', post: { parts: ['Words.'] } })
}

/** The settings form's payload for a persona as `list` returns it: every field `update` takes, nothing it refuses. */
function settingsOf(persona: FunctionReturnType<typeof api.private.personas.list>[number]) {
  return {
    personaId: persona._id,
    name: persona.name,
    color: persona.color,
    handle: persona.handle,
    niche: persona.niche,
    tone: persona.tone,
    bio: persona.bio,
    bible: persona.bible,
    pillars: persona.pillars,
    formats: persona.formats,
    voiceId: persona.voiceId,
    sponsorDial: persona.sponsorDial,
    sponsorRampEpisodes: persona.sponsorRampEpisodes,
    episodesPerWeek: persona.episodesPerWeek,
    autoApprove: persona.autoApprove,
    timezone: persona.timezone,
  }
}

async function claimUntil(t: ReturnType<typeof setup>, kind: 'produce' | 'publish', episodeId: string) {
  for (let i = 0; i < 12; i += 1) {
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
