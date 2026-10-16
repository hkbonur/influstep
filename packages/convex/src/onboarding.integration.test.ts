import { DEFAULT_FORMATS, freeHandle, producePayloadSchema, type PersonaProposal, type PlatformFormat } from '@influstep/shared'
import type { FunctionArgs } from 'convex/server'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import { addDays, dayKey, weekStart } from './core/dates'
import { approveEpisode } from './core/episodes'
import { storeFile } from '../test/fixtures'
import { writeScriptsDueBefore } from '../test/scripts'
import { setup } from '../test/setup'

const TIMEZONE = 'Europe/Oslo'
const TIKTOK: PlatformFormat = { platform: 'tiktok', ...DEFAULT_FORMATS.tiktok }

type Test = ReturnType<typeof setup>
type CreateArgs = FunctionArgs<typeof api.private.onboarding.create>

function createArgs(niche: string, audience: string, proposal: PersonaProposal): CreateArgs {
  return {
    appUrl: 'http://localhost:3300',
    niche,
    audience,
    ...proposal,
    color: 'plum',
    style: 'cartoon',
    references: [],
    voice: { kind: 'id', voiceId: 'mock-voice' },
    formats: [TIKTOK],
    sponsorDial: 0.3,
    episodesPerWeek: 3,
    timezone: TIMEZONE,
  }
}

async function proposeAndCreate(t: Test, niche: string, audience: string, change: Partial<CreateArgs> = {}) {
  const proposal = await t.action(api.private.onboarding.propose, { niche, audience })
  const outcome = await t.mutation(api.private.onboarding.create, { ...createArgs(niche, audience, proposal), ...change })
  if (outcome.status !== 'created') throw new Error(`refused: ${outcome.message}`)
  return { proposal, personaId: outcome.personaId }
}

describe('onboarding', () => {
  it('builds a persona on an empty backend: the workspace, the persona, its look, and its first two weeks planned', async () => {
    const t = setup()
    expect((await t.query(api.private.onboarding.start, {})).roster).toEqual([])

    const { proposal, personaId } = await proposeAndCreate(t, 'Notion for freelancers', 'freelance designers')
    expect(proposal).toMatchObject({ name: 'Nora Notion', handle: 'nora.notion' })
    expect(proposal.pillars).toHaveLength(3)

    const workspace = await t.query(api.private.workspace.get, {})
    expect(workspace).toMatchObject({ sponsorName: 'Formstep', appUrl: 'http://localhost:3300' })

    await t.finishAllScheduledFunctions(() => {})
    const page = await t.query(api.private.personas.get, { personaId })
    expect(page?.persona).toMatchObject({
      audience: 'freelance designers',
      autoApprove: false,
      sponsorRampEpisodes: 10,
      voiceId: 'mock-voice',
      appearance: { style: 'cartoon', referenceAssetIds: [] },
    })
    expect(page?.bioLink).not.toBeNull()
    // This week's remaining days and next week's.
    const today = dayKey(Date.now(), TIMEZONE)
    const nextWeekEnd = addDays(weekStart(today), 13)
    const videos = page?.episodes.filter((episode) => episode.kind === 'video') ?? []
    expect(videos.length).toBeGreaterThanOrEqual(3)
    expect(videos.every((episode) => episode.plannedFor >= today && episode.plannedFor <= nextWeekEnd)).toBe(true)
    expect(videos.some((episode) => episode.plannedFor > addDays(weekStart(today), 6))).toBe(true)
  })

  it('proposes a second persona apart from the first, and refuses a handle that is taken', async () => {
    const t = setup()
    await proposeAndCreate(t, 'Notion for freelancers', 'freelance designers')
    const second = await t.action(api.private.onboarding.propose, { niche: 'Notion for students', audience: 'students' })
    expect(second.name).not.toBe('Nora Notion')
    expect(second.handle).not.toBe('nora.notion')
    await expect(
      t.mutation(api.private.onboarding.create, { ...createArgs('Notion for students', 'students', second), handle: 'nora.notion' })
    ).rejects.toThrow('The handle nora.notion is taken.')
    expect(freeHandle('nora.notion', ['nora.notion'])).toBe('nora.notion2')
  })

  it('refuses a proposal without a niche or with too few pillars, and a look that cannot go with its formats', async () => {
    const t = setup()
    await expect(t.action(api.private.onboarding.propose, { niche: ' ', audience: 'anyone' })).rejects.toThrow(
      'Say what the persona is about: its niche.'
    )
    const proposal = await t.action(api.private.onboarding.propose, { niche: 'Excel for accountants', audience: 'accountants' })
    const base = createArgs('Excel for accountants', 'accountants', proposal)
    await expect(t.mutation(api.private.onboarding.create, { ...base, pillars: ['Formulas'] })).rejects.toThrow(
      'Give 3 to 5 content pillars, comma separated.'
    )
    // TikTok's default delivery is a talking head, which a persona with no presenter has no face for.
    await expect(t.mutation(api.private.onboarding.create, { ...base, style: 'voice_only' })).rejects.toThrow(/Screen only/)
    await expect(
      t.mutation(api.private.onboarding.create, { ...base, voice: { kind: 'description', description: 'calm' } })
    ).rejects.toThrow(/at least 20 characters/)
    expect((await t.query(api.private.onboarding.start, {})).roster).toEqual([])
  })

  it('keeps the references in the asset library, and hands them to the producer with the look', async () => {
    const t = setup()
    const image = await storeFile(t, 'png', 'image/png')
    const clip = await storeFile(t, 'mp4', 'video/mp4')
    const { personaId } = await proposeAndCreate(t, 'Figma for founders', 'founders', {
      style: 'photoreal',
      references: [
        { storageId: image, fileName: 'front-face.png' },
        { storageId: clip, fileName: 'walk_in.mp4' },
      ],
    })
    const library = await t.query(api.private.assets.list, { personaId })
    const references = library?.assets.filter((asset) => asset.tags.includes('reference')) ?? []
    expect(references.map((asset) => [asset.name, asset.kind]).sort()).toEqual([
      ['front face', 'image'],
      ['walk in', 'clip'],
    ])
    const persona = await t.run(async (ctx) => ctx.db.get(personaId))
    expect(persona?.appearance?.referenceAssetIds).toHaveLength(2)

    // Approving a written video queues the producer with the look and where to fetch each reference.
    await t.finishAllScheduledFunctions(() => {})
    const videos = async () =>
      (
        await t.run(async (ctx) =>
          ctx.db
            .query('episodes')
            .withIndex('by_persona', (q) => q.eq('personaId', personaId))
            .collect()
        )
      )
        .filter((episode) => episode.kind === 'video')
        .sort((a, b) => a.plannedFor.localeCompare(b.plannedFor))
    const [first] = await videos()
    if (!first) throw new Error('nothing planned')
    await writeScriptsDueBefore(t, personaId, first.plannedFor)
    const scripted = (await videos()).find((episode) => episode._id === first._id)
    if (scripted?.status !== 'scripted') throw new Error(`the first video is ${scripted?.status}, not scripted`)
    await t.run(async (ctx) => approveEpisode(ctx, scripted._id))
    const job = await t.mutation(internal.internal.runner.claimNext, { runnerName: 'test' })
    if (job?.kind !== 'produce') throw new Error('no produce job')
    const payload = producePayloadSchema.parse(job.payload)
    if (payload.kind !== 'video') throw new Error('not a video')
    expect(payload.appearance?.style).toBe('photoreal')
    expect(payload.appearance?.references.map((reference) => reference.kind)).toEqual(['image', 'clip'])

    // Deleting a reference takes it off the look.
    const face = references.find((asset) => asset.kind === 'image')
    if (!face) throw new Error('no image reference')
    await t.mutation(api.private.assets.remove, { assetId: face._id })
    expect((await t.run(async (ctx) => ctx.db.get(personaId)))?.appearance?.referenceAssetIds).toHaveLength(1)
  })

  it('refuses a reference the library does not take, deletes the files, and creates nothing', async () => {
    const t = setup()
    const image = await storeFile(t, 'png', 'image/png')
    const text = await storeFile(t, 'notes', 'text/plain')
    const proposal = await t.action(api.private.onboarding.propose, { niche: 'Excel for accountants', audience: 'accountants' })
    const outcome = await t.mutation(api.private.onboarding.create, {
      ...createArgs('Excel for accountants', 'accountants', proposal),
      references: [
        { storageId: image, fileName: 'face.png' },
        { storageId: text, fileName: 'notes.txt' },
      ],
    })
    expect(outcome).toEqual({ status: 'refused', message: 'notes.txt is no picture or clip: a reference shows how the persona looks.' })
    expect(await t.run(async (ctx) => [await ctx.db.system.get(image), await ctx.db.system.get(text)])).toEqual([null, null])
    expect((await t.query(api.private.onboarding.start, {})).roster).toEqual([])
  })

  it('makes the voice from a description on the runner, and holds a video until it is made', async () => {
    const t = setup()
    const { personaId } = await proposeAndCreate(t, 'Notion for freelancers', 'freelance designers', {
      voice: { kind: 'description', description: 'A warm woman in her thirties, unhurried, a light Nordic accent.' },
    })
    let persona = await t.run(async (ctx) => ctx.db.get(personaId))
    expect(persona?.voiceId).toBeUndefined()
    expect(persona?.voiceDescription).toBe('A warm woman in her thirties, unhurried, a light Nordic accent.')
    await t.finishAllScheduledFunctions(() => {})

    const idea = await t.run(async (ctx) =>
      (
        await ctx.db
          .query('episodes')
          .withIndex('by_persona', (q) => q.eq('personaId', personaId))
          .collect()
      ).find((episode) => episode.kind === 'video')
    )
    if (!idea) throw new Error('nothing planned')
    await expect(t.run(async (ctx) => approveEpisode(ctx, idea._id))).rejects.toThrow('Nora Notion has no voice yet')

    const job = await t.mutation(internal.internal.runner.claimNext, { runnerName: 'test' })
    expect(job).toMatchObject({ kind: 'design_voice', payload: { personaName: 'Nora Notion' } })
    if (!job) throw new Error('no job')
    const jobId = await t.run(async (ctx) => ctx.db.normalizeId('jobs', job.id))
    if (!jobId) throw new Error('no job id')
    await t.mutation(internal.internal.runner.complete, { jobId, result: { voiceId: 'mock-designed-nora', mock: true } })
    persona = await t.run(async (ctx) => ctx.db.get(personaId))
    expect(persona?.voiceId).toBe('mock-designed-nora')
  })

  it('gives a Loom-style presenter the face the operator picks, and a portrait drawn from their words that leads the look', async () => {
    const t = setup()
    const proposal = await t.action(api.private.onboarding.propose, { niche: 'Figma for founders', audience: 'founders' })
    const loom = {
      ...createArgs('Figma for founders', 'founders', proposal),
      style: 'loom' as const,
      formats: [{ ...TIKTOK, delivery: 'screen_with_avatar' as const }],
    }
    await expect(t.mutation(api.private.onboarding.create, loom)).rejects.toThrow(
      'Pick whether the Loom-style presenter is a cartoon or realistic.'
    )
    await expect(t.mutation(api.private.onboarding.create, { ...loom, face: 'cartoon', formats: [TIKTOK] })).rejects.toThrow(
      /Screen with avatar/
    )
    await expect(t.mutation(api.private.onboarding.create, { ...loom, face: 'cartoon', portrait: 'A photo of Jane Doe' })).rejects.toThrow(
      /The portrait: A generated picture never shows a real person/
    )

    const outcome = await t.mutation(api.private.onboarding.create, {
      ...loom,
      face: 'cartoon',
      portrait: 'Short grey hair, round glasses.',
    })
    if (outcome.status !== 'created') throw new Error(outcome.message)
    await t.finishAllScheduledFunctions(() => {})
    const persona = await t.run(async (ctx) => ctx.db.get(outcome.personaId))
    expect(persona?.appearance).toMatchObject({ style: 'loom', face: 'cartoon' })
    const [portraitId] = persona?.appearance?.referenceAssetIds ?? []
    if (!portraitId) throw new Error('the look has no portrait')
    const portrait = await t.run(async (ctx) => ctx.db.get(portraitId))
    expect(portrait).toMatchObject({
      name: `Portrait of ${proposal.name}`,
      tags: ['generated', 'reference'],
      source: 'producer',
      kind: 'image',
    })
    const generation = await t.run(async (ctx) => (await ctx.db.query('generations').collect()).find((row) => row.portrait))
    expect(generation?.prompt).toBe('Short grey hair, round glasses.')
  })
})
