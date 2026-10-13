import { describe, expect, it } from 'vitest'
import { DEFAULT_FORMATS, EXPERIMENT_CATALOG, RUNNER_STALE_MS, effectiveVariant } from '@influstep/shared'
import { api, internal } from '../_generated/api'
import { PRESENTER_TOOL } from '../providers/llm'
import { insertEpisode, insertJob, insertPersona, insertPublication, TIMEZONE, VIDEO_HOUR } from '../../test/fixtures'
import { setup } from '../../test/setup'
import { addDays, dayKey, instantAt } from './dates'
import {
  KILLED_BEFORE_RUN,
  completeProduction,
  completePublication,
  formatAndShots,
  killEpisode,
  rescheduleEpisode,
  shotsFromDraft,
} from './episodes'

const SPONSOR = 'Formstep'

/** A talking-head script: every beat is the presenter. */
const presenterBeats = {
  shotPlan: [
    { title: 'The hook', voiceover: 'Your agent failed again.', tool: PRESENTER_TOOL, url: '' },
    { title: 'The fix', voiceover: 'Read the log first.', tool: PRESENTER_TOOL, url: '' },
  ],
}

/** A screen script: a browser beat, then the sponsor's own screen. */
const screenBeats = {
  shotPlan: [
    {
      title: 'The problem',
      voiceover: 'Retry a failed webhook. It lost the payload.',
      tool: 'browser',
      url: 'https://news.ycombinator.com',
    },
    { title: 'The fix', voiceover: 'Add an error workflow.', tool: 'n8n', url: 'http://localhost:5678' },
    { title: 'Formstep demo', voiceover: 'Here it is.', tool: SPONSOR, url: 'https://formstep.io' },
  ],
}

describe('shotsFromDraft', () => {
  it('speaks every beat to camera for a talking head', () => {
    expect(shotsFromDraft(screenBeats, SPONSOR, 'talking_head').map((shot) => shot.kind)).toEqual(['avatar', 'avatar', 'avatar'])
  })
  it('opens on the presenter speaking the first beat, then records the screens, for screen with avatar', () => {
    const shots = shotsFromDraft(screenBeats, SPONSOR, 'screen_with_avatar')
    expect(shots.map((shot) => shot.kind)).toEqual(['avatar', 'screen', 'screen'])
    // Every shot speaks its own beat, so the recording says the script, the first beat included.
    expect(shots.map((shot) => shot.voiceover)).toEqual(screenBeats.shotPlan.map((beat) => beat.voiceover))
    const demo = shots[2]
    if (demo?.kind !== 'screen') throw new Error('the sponsor demo is a screen')
    expect(demo.recipe.map((step) => step.step)).toEqual(['goto', 'wait', 'scroll', 'wait'])
  })
  it('keeps a presenter beat as a take under a screen delivery', () => {
    // The beats a talking-head script stored, after the episode widened to a screen platform.
    for (const delivery of ['screen_only', 'screen_with_avatar'] as const) {
      const shots = shotsFromDraft(presenterBeats, SPONSOR, delivery)
      expect(shots.map((shot) => shot.kind)).toEqual(['avatar', 'avatar'])
      expect(shots.map((shot) => shot.voiceover)).toEqual(presenterBeats.shotPlan.map((beat) => beat.voiceover))
    }
  })
})

describe('formatAndShots', () => {
  const persona = { formats: [{ platform: 'youtube' as const, ...DEFAULT_FORMATS.youtube }] }
  const lengthOf = (key: string) =>
    formatAndShots({
      persona,
      platforms: ['youtube'],
      draft: presenterBeats,
      sponsorName: SPONSOR,
      length: effectiveVariant('length', { variant: lengthVariant(key) }, undefined),
    }).format.lengthSec

  function lengthVariant(key: string) {
    const variant = EXPERIMENT_CATALOG.length.find((candidate) => candidate.key === key)
    if (!variant) throw new Error(`the length catalog has no "${key}"`)
    return { kind: 'length' as const, ...variant }
  }

  it("scales the format's length by the length variant", () => {
    expect(lengthOf('standard')).toBe(DEFAULT_FORMATS.youtube.lengthSec)
    expect(lengthOf('shorter')).toBe(Math.round(DEFAULT_FORMATS.youtube.lengthSec * 0.7))
    expect(lengthOf('longer')).toBe(Math.round(DEFAULT_FORMATS.youtube.lengthSec * 1.3))
  })

  it('refuses a variant of another dimension in place of the length', () => {
    expect(() =>
      formatAndShots({
        persona,
        platforms: ['youtube'],
        draft: presenterBeats,
        sponsorName: SPONSOR,
        length: effectiveVariant('cta', {}, undefined),
      })
    ).toThrow('formatAndShots takes the length variant, not a cta variant')
  })
})

describe('killEpisode', () => {
  it('withdraws every publication that has not gone out and fails the jobs still queued', async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const { episode, rows } = await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const episode = await insertEpisode(ctx, persona, { status: 'failed', plannedFor: today })
      const rows = {
        draft: await insertPublication(ctx, episode, { platform: 'youtube', status: 'draft' }),
        queued: await insertPublication(ctx, episode, { platform: 'tiktok', status: 'queued' }),
        failed: await insertPublication(ctx, episode, { platform: 'instagram', status: 'failed' }),
        live: await insertPublication(ctx, episode, { platform: 'x', status: 'live' }),
        queuedJob: await insertJob(ctx, episode, { kind: 'produce', status: 'queued' }),
        runningJob: await insertJob(ctx, episode, { kind: 'write_script', status: 'running' }),
        doneJob: await insertJob(ctx, episode, { kind: 'write_script', status: 'done' }),
      }
      return { episode, rows }
    })

    await t.run((ctx) => killEpisode(ctx, episode._id))

    const after = await t.run(async (ctx) => ({
      episode: await ctx.db.get(episode._id),
      draft: await ctx.db.get(rows.draft._id),
      queued: await ctx.db.get(rows.queued._id),
      failed: await ctx.db.get(rows.failed._id),
      live: await ctx.db.get(rows.live._id),
      queuedJob: await ctx.db.get(rows.queuedJob._id),
      runningJob: await ctx.db.get(rows.runningJob._id),
      doneJob: await ctx.db.get(rows.doneJob._id),
    }))
    expect(after.episode?.status).toBe('killed')
    expect([after.draft?.status, after.queued?.status, after.failed?.status, after.live?.status]).toEqual([
      'withdrawn',
      'withdrawn',
      'withdrawn',
      'live',
    ])
    expect([after.queuedJob?.status, after.queuedJob?.error]).toEqual(['failed', KILLED_BEFORE_RUN])
    // A job already running finishes against the killed episode; one that finished stays as it was.
    expect(after.runningJob?.status).toBe('running')
    expect(after.doneJob?.status).toBe('done')
  })

  it('refuses while a publication is uploading, and changes nothing', async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const { episode, draft, job } = await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const episode = await insertEpisode(ctx, persona, { status: 'scheduled', plannedFor: today, concept: 'Retry a webhook' })
      await insertPublication(ctx, episode, { platform: 'youtube', status: 'uploading' })
      const draft = await insertPublication(ctx, episode, { platform: 'x', status: 'queued' })
      const job = await insertJob(ctx, episode, { kind: 'publish', status: 'queued' })
      return { episode, draft, job }
    })

    await expect(t.run((ctx) => killEpisode(ctx, episode._id))).rejects.toThrow(
      '"Retry a webhook" is uploading to YouTube; it cannot be killed now.'
    )
    const after = await t.run(async (ctx) => ({
      episode: await ctx.db.get(episode._id),
      draft: await ctx.db.get(draft._id),
      job: await ctx.db.get(job._id),
    }))
    expect([after.episode?.status, after.draft?.status, after.job?.status]).toEqual(['scheduled', 'queued', 'queued'])
  })

  it('refuses an episode that has gone out', async () => {
    const t = setup()
    const episode = await t.run(async (ctx) =>
      insertEpisode(ctx, await insertPersona(ctx), { status: 'published', plannedFor: dayKey(Date.now(), TIMEZONE) })
    )
    await expect(t.run((ctx) => killEpisode(ctx, episode._id))).rejects.toThrow('An episode at "Published" cannot be killed.')
  })

  it('sends nothing of a killed scheduled episode when its time comes', async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const { episode, publications } = await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const episode = await insertEpisode(ctx, persona, { status: 'scheduled', plannedFor: today })
      const publications = [
        await insertPublication(ctx, episode, { platform: 'youtube', status: 'queued' }),
        await insertPublication(ctx, episode, { platform: 'x', status: 'queued' }),
      ]
      return { episode, publications }
    })

    await t.run((ctx) => killEpisode(ctx, episode._id))
    const dispatched = await t.mutation(internal.internal.runner.dispatchDuePublications, { now: episode.scheduledAt + 60_000 })

    expect(dispatched).toEqual({ dispatched: 0 })
    const after = await t.run(async (ctx) => ({
      statuses: await Promise.all(publications.map(async (publication) => (await ctx.db.get(publication._id))?.status)),
      publishJobs: (await ctx.db.query('jobs').collect()).filter((job) => job.kind === 'publish'),
    }))
    expect(after.statuses).toEqual(['withdrawn', 'withdrawn'])
    expect(after.publishJobs).toEqual([])
  })
})

describe('a killed episode afterwards', () => {
  it('refuses to retry the jobs the kill failed, so the writer and the runner never work for nothing', async () => {
    const t = setup()
    const { script, render } = await t.run(async (ctx) => {
      const episode = await insertEpisode(ctx, await insertPersona(ctx), {
        status: 'killed',
        plannedFor: dayKey(Date.now(), TIMEZONE),
        concept: 'Retry a webhook',
      })
      return {
        script: await insertJob(ctx, episode, { kind: 'write_script', status: 'failed' }),
        render: await insertJob(ctx, episode, { kind: 'produce', status: 'failed' }),
      }
    })

    for (const job of [script, render])
      await expect(t.mutation(api.private.jobs.retry, { jobId: job._id })).rejects.toThrow(
        '"Retry a webhook" was killed; its jobs do not run again.'
      )
    const queued = await t.run(async (ctx) => (await ctx.db.query('jobs').collect()).filter((job) => job.status === 'queued'))
    expect(queued).toEqual([])
  })

  it('never retries an upload as a job, killed or not: the episode sends it again through dispatch', async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const { failedUpload, killedUpload, withdrawn } = await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const failed = await insertEpisode(ctx, persona, { status: 'failed', plannedFor: today, concept: 'Retry a webhook' })
      await insertPublication(ctx, failed, { platform: 'youtube', status: 'failed' })
      const killed = await insertEpisode(ctx, persona, { status: 'killed', plannedFor: today, concept: 'Pause for a signature' })
      const withdrawn = await insertPublication(ctx, killed, { platform: 'youtube', status: 'withdrawn' })
      return {
        failedUpload: await insertJob(ctx, failed, { kind: 'publish', status: 'failed' }),
        killedUpload: await insertJob(ctx, killed, { kind: 'publish', status: 'failed' }),
        withdrawn,
      }
    })

    await expect(t.mutation(api.private.jobs.retry, { jobId: failedUpload._id })).rejects.toThrow(
      'An upload goes out again with its episode: retry "Retry a webhook" instead.'
    )
    await expect(t.mutation(api.private.jobs.retry, { jobId: killedUpload._id })).rejects.toThrow(
      '"Pause for a signature" was killed; its jobs do not run again.'
    )
    const after = await t.run(async (ctx) => ({
      queued: (await ctx.db.query('jobs').collect()).filter((job) => job.status === 'queued'),
      withdrawn: await ctx.db.get(withdrawn._id),
    }))
    expect(after.queued).toEqual([])
    expect(after.withdrawn?.status).toBe('withdrawn')
  })

  it('fails a render orphaned after the kill instead of handing it to the runner again', async () => {
    const t = setup()
    const orphan = await t.run(async (ctx) => {
      const episode = await insertEpisode(ctx, await insertPersona(ctx), { status: 'killed', plannedFor: dayKey(Date.now(), TIMEZONE) })
      const job = await insertJob(ctx, episode, { kind: 'produce', status: 'running' })
      // The process holding it went silent long enough ago that the job counts as orphaned.
      await ctx.db.patch(job._id, { startedAt: Date.now() - RUNNER_STALE_MS - 1_000 })
      return job
    })

    expect(await t.mutation(internal.internal.runner.claimNext, { runnerName: 'test' })).toBeNull()
    const after = await t.run((ctx) => ctx.db.get(orphan._id))
    expect([after?.status, after?.error]).toEqual(['failed', KILLED_BEFORE_RUN])
  })

  it('keeps a withdrawn publication withdrawn when an upload of it still reports back', async () => {
    const t = setup()
    const { episode, publication } = await t.run(async (ctx) => {
      const episode = await insertEpisode(ctx, await insertPersona(ctx), { status: 'killed', plannedFor: dayKey(Date.now(), TIMEZONE) })
      return { episode, publication: await insertPublication(ctx, episode, { platform: 'youtube', status: 'withdrawn' }) }
    })

    const outcome = await t.run((ctx) =>
      completePublication(ctx, publication._id, {
        externalId: 'yt-1',
        url: 'https://youtube.example/1',
        publishedAt: Date.now(),
        mock: true,
      })
    )

    expect(outcome).toBe('withdrawn')
    const after = await t.run(async (ctx) => ({ episode: await ctx.db.get(episode._id), publication: await ctx.db.get(publication._id) }))
    expect([after.episode?.status, after.publication?.status, after.publication?.url]).toEqual(['killed', 'withdrawn', undefined])
  })
})

describe('completeProduction', () => {
  it('stores nothing for an episode killed while it rendered, and does not throw', async () => {
    const t = setup()
    const episode = await t.run(async (ctx) =>
      insertEpisode(ctx, await insertPersona(ctx), { status: 'killed', plannedFor: dayKey(Date.now(), TIMEZONE) })
    )
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['video'])))

    const outcome = await t.run((ctx) =>
      completeProduction(ctx, episode._id, { renders: [{ aspect: '16:9', storageId, durationSec: 50, mock: true }] })
    )

    expect(outcome).toBe('killed')
    const after = await t.run(async (ctx) => ({
      episode: await ctx.db.get(episode._id),
      publications: await ctx.db
        .query('publications')
        .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
        .collect(),
    }))
    expect([after.episode?.status, after.episode?.renders, after.publications]).toEqual(['killed', [], []])
  })
})

describe('rescheduleEpisode', () => {
  it('refuses an episode past changing, saying it cannot be moved', async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const episode = await t.run(async (ctx) => insertEpisode(ctx, await insertPersona(ctx), { status: 'measured', plannedFor: today }))
    await expect(t.run((ctx) => rescheduleEpisode(ctx, episode._id, addDays(today, 1)))).rejects.toThrow(
      'An episode at "Measured" cannot be moved.'
    )
  })

  it("moves a video and the publications waiting for dispatch to the platforms' hours of the new day", async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const to = addDays(today, 2)
    const { episode, draft, failed } = await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const episode = await insertEpisode(ctx, persona, { status: 'rendered', plannedFor: addDays(today, 1) })
      return {
        episode,
        draft: await insertPublication(ctx, episode, { platform: 'youtube', status: 'draft' }),
        failed: await insertPublication(ctx, episode, { platform: 'x', status: 'failed' }),
      }
    })

    await t.run((ctx) => rescheduleEpisode(ctx, episode._id, to))

    const after = await t.run(async (ctx) => ({
      episode: await ctx.db.get(episode._id),
      draft: await ctx.db.get(draft._id),
      failed: await ctx.db.get(failed._id),
    }))
    expect(after.episode?.plannedFor).toBe(to)
    expect(after.draft?.scheduledAt).toBe(instantAt(to, VIDEO_HOUR, TIMEZONE))
    // A failed publication keeps its time until a retry arms it again.
    expect(after.failed?.scheduledAt).toBe(failed.scheduledAt)
  })
})
