import { runnerJobSchema } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { addDays, dayKey, weekStart } from './core/dates'
import { createIdea } from './core/episodes'
import { TIMEZONE, insertPersona } from '../test/fixtures'
import { writeScriptsDueBefore } from '../test/scripts'
import { storeFile } from '../test/fixtures'
import { setup } from '../test/setup'

type Test = ReturnType<typeof setup>

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="#fafafa"/></svg>'

async function upload(
  t: Test,
  personaId: Id<'personas'>,
  file: { body: string; type: string },
  text: { name: string; tags: string[]; note?: string }
) {
  const storageId = await storeFile(t, file.body, file.type)
  const outcome = await t.mutation(api.private.assets.add, { personaId, storageId, note: '', ...text })
  return { storageId, outcome }
}

async function library(t: Test, personaId: Id<'personas'>) {
  const view = await t.query(api.private.assets.list, { personaId })
  if (!view) throw new Error('the persona is gone')
  return view.assets
}

/** One video idea for next week, scripted by the mock writer the morning before, as the due-script pass runs it. */
async function writtenVideo(t: Test, persona: Doc<'personas'>, concept: string): Promise<Doc<'episodes'>> {
  const plannedFor = addDays(weekStart(dayKey(Date.now(), TIMEZONE)), 7)
  const episodeId = await t.run((ctx) =>
    createIdea(ctx, persona, {
      personaId: persona._id,
      plannedFor,
      concept,
      pillar: 'n8n tutorials',
      sponsorSegment: 'none',
      signalIds: [],
      kind: 'video',
    })
  )
  await t.finishAllScheduledFunctions(() => {})
  await writeScriptsDueBefore(t, persona._id, plannedFor)
  const episode = await t.run((ctx) => ctx.db.get(episodeId))
  if (episode?.status !== 'scripted') throw new Error(`the writer left the episode at ${episode?.status}`)
  return episode
}

/** The docs/plan.md slice 10 asset library: uploads, placement by the writer, the runner's payload, the producer's saves. */
describe('the asset library', () => {
  it('stores an upload with its kind, refuses and deletes a file it does not take, and edits the name and tags', async () => {
    const t = setup()
    const persona = await t.run((ctx) => insertPersona(ctx))

    const { outcome } = await upload(
      t,
      persona._id,
      { body: SVG, type: 'image/svg+xml' },
      { name: '  Pricing   page ', tags: ['Pricing', '#pricing', 'shot'] }
    )
    expect(outcome).toEqual({ status: 'stored', assetId: expect.any(String) })
    const [stored] = await library(t, persona._id)
    expect(stored).toMatchObject({
      kind: 'image',
      name: 'Pricing page',
      tags: ['pricing', 'shot'],
      contentType: 'image/svg+xml',
      source: 'operator',
      episodeTitle: null,
      shownIn: [],
    })
    expect(stored?.url).toContain('http')
    if (!stored) throw new Error('nothing stored')

    const zip = await upload(t, persona._id, { body: 'PK', type: 'application/zip' }, { name: 'Archive', tags: [] })
    expect(zip.outcome).toEqual({
      status: 'refused',
      message: 'The library takes images, clips, audio, PDFs and text; this file is application/zip.',
    })
    // Refused and gone: the refusal is returned, not thrown, so the delete is kept.
    expect(await t.run((ctx) => ctx.db.system.get(zip.storageId))).toBeNull()
    expect(await library(t, persona._id)).toHaveLength(1)

    await expect(t.mutation(api.private.assets.update, { assetId: stored._id, name: ' ', tags: [], note: '' })).rejects.toThrow(
      'Give the asset a name the writer can ask for.'
    )
    await t.mutation(api.private.assets.update, { assetId: stored._id, name: 'Pricing screenshot', tags: ['Plans'], note: ' October. ' })
    expect((await library(t, persona._id))[0]).toMatchObject({ name: 'Pricing screenshot', tags: ['plans'], note: 'October.' })
  })

  it('places the asset the writer asks for, sends it to the runner, saves what the producer made and keeps what an episode needs', async () => {
    const t = setup()
    const persona = await t.run((ctx) => insertPersona(ctx))
    // The mock writer shows the first asset with a tag the concept says word for word; a document is never shown.
    await upload(t, persona._id, { body: SVG, type: 'image/svg+xml' }, { name: 'Retry settings', tags: ['webhooks'] })
    await upload(t, persona._id, { body: 'notes', type: 'text/plain' }, { name: 'Webhook notes', tags: ['webhooks'] })
    const canvas = (await library(t, persona._id)).find((asset) => asset.kind === 'image')
    if (!canvas) throw new Error('the image was not stored')

    const scripted = await writtenVideo(t, persona, 'n8n webhooks that retry')
    const fix = scripted.shotPlan?.find((beat) => beat.title === 'The fix')
    expect(fix?.assetId).toBe(canvas._id)
    const shot = scripted.shots.find((candidate) => candidate.kind === 'asset')
    expect(shot).toMatchObject({ kind: 'asset', title: 'The fix', assetId: canvas._id })
    expect((await t.query(api.private.episodes.get, { episodeId: scripted._id }))?.assets).toEqual([
      { _id: canvas._id, name: 'Retry settings', kind: 'image' },
    ])
    expect((await library(t, persona._id)).find((asset) => asset._id === canvas._id)?.shownIn).toEqual([scripted.title])

    // The script may still be recorded, so the asset stays.
    await expect(t.mutation(api.private.assets.remove, { assetId: canvas._id })).rejects.toThrow(
      `"${scripted.title}" shows this image; it stays until that episode is measured or killed.`
    )

    // The runner gets where to download it and that it is a still to hold.
    await t.mutation(api.private.episodes.approve, { episodeId: scripted._id })
    // The wire type widens the union; the schema narrows it again. The episode's produce job is the only runner job.
    const job = runnerJobSchema.parse(await t.mutation(internal.internal.runner.claimNext, { runnerName: 'test' }))
    if (job.kind !== 'produce' || job.payload.kind !== 'video') throw new Error(`expected a video produce job, got ${job.kind}`)
    expect(job.payload.episodeId).toBe(scripted._id)
    expect(job.payload.assets).toEqual([{ assetId: canvas._id, url: expect.stringContaining('http'), kind: 'image' }])

    // The producer's renders and voice track land in the library, named after the episode.
    const render = await storeFile(t, 'video', 'video/mp4')
    const voice = await storeFile(t, 'voice', 'audio/mp4')
    await t.mutation(internal.internal.runner.complete, {
      jobId: job.id as Id<'jobs'>,
      result: {
        renders: [
          { aspect: '16:9', storageId: render, durationSec: 40, mock: true },
          { aspect: '9:16', storageId: render, durationSec: 40, mock: true },
        ],
        voiceStorageId: voice,
      },
    })
    const made = (await library(t, persona._id)).filter((asset) => asset.source === 'producer')
    expect(made.map((asset) => [asset.kind, asset.name, asset.tags, asset.episodeTitle, asset.keptByEpisode]).sort()).toEqual([
      ['audio', `${scripted.title} (voice)`, ['voice track'], scripted.title, false],
      ['clip', `${scripted.title} (vertical)`, ['render', '9:16'], scripted.title, true],
      ['clip', `${scripted.title} (wide)`, ['render', '16:9'], scripted.title, true],
    ])

    // A render taken out of the library stays on its episode; the voice track goes with its asset.
    for (const asset of made) await t.mutation(api.private.assets.remove, { assetId: asset._id })
    expect(await t.run((ctx) => ctx.db.system.get(render))).not.toBeNull()
    expect(await t.run((ctx) => ctx.db.system.get(voice))).toBeNull()

    // Killed, the episode lets its asset go, file and all.
    await t.mutation(api.private.episodes.kill, { episodeId: scripted._id })
    await t.mutation(api.private.assets.remove, { assetId: canvas._id })
    expect(await t.run((ctx) => ctx.db.system.get(canvas.storageId))).toBeNull()
  })
})
