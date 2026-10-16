import { DEFAULT_FORMATS, freeHandle } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import { addDays, dayKey, weekStart } from './core/dates'
import { setup } from '../test/setup'

const TIMEZONE = 'Europe/Oslo'

type Test = ReturnType<typeof setup>

async function proposeAndCreate(t: Test, niche: string, audience: string) {
  const proposal = await t.action(api.private.onboarding.propose, { niche, audience })
  const personaId = await t.mutation(api.private.onboarding.create, {
    appUrl: 'http://localhost:3300',
    niche,
    audience,
    ...proposal,
    color: 'plum',
    formats: [{ platform: 'tiktok', ...DEFAULT_FORMATS.tiktok }],
    voiceId: 'mock-voice',
    sponsorDial: 0.3,
    episodesPerWeek: 3,
    timezone: TIMEZONE,
  })
  return { proposal, personaId }
}

describe('onboarding', () => {
  it('builds a persona on an empty backend: the workspace, the persona, and its first two weeks planned', async () => {
    const t = setup()
    expect((await t.query(api.private.onboarding.start, {})).roster).toEqual([])

    const { proposal, personaId } = await proposeAndCreate(t, 'Notion for freelancers', 'freelance designers')
    expect(proposal).toMatchObject({ name: 'Nora Notion', handle: 'nora.notion' })
    expect(proposal.pillars).toHaveLength(3)

    const workspace = await t.query(api.private.workspace.get, {})
    expect(workspace).toMatchObject({ sponsorName: 'Formstep', appUrl: 'http://localhost:3300' })

    await t.finishAllScheduledFunctions(() => {})
    const page = await t.query(api.private.personas.get, { personaId })
    expect(page?.persona).toMatchObject({ audience: 'freelance designers', autoApprove: false, sponsorRampEpisodes: 10 })
    expect(page?.bioLink).not.toBeNull()
    // This week's remaining days and next week's, three videos a week at most each.
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
      t.mutation(api.private.onboarding.create, {
        appUrl: 'http://localhost:3300',
        niche: 'Notion for students',
        audience: 'students',
        ...second,
        handle: 'nora.notion',
        color: 'teal',
        formats: [{ platform: 'youtube', ...DEFAULT_FORMATS.youtube }],
        voiceId: 'mock-voice',
        sponsorDial: 0.3,
        episodesPerWeek: 2,
        timezone: TIMEZONE,
      })
    ).rejects.toThrow('The handle nora.notion is taken.')
    expect(freeHandle('nora.notion', ['nora.notion'])).toBe('nora.notion2')
  })

  it('refuses a proposal without a niche or with too few pillars, in the operator’s words', async () => {
    const t = setup()
    await expect(t.action(api.private.onboarding.propose, { niche: ' ', audience: 'anyone' })).rejects.toThrow(
      'Say what the persona is about: its niche.'
    )
    const proposal = await t.action(api.private.onboarding.propose, { niche: 'Excel for accountants', audience: 'accountants' })
    await expect(
      t.mutation(api.private.onboarding.create, {
        appUrl: 'http://localhost:3300',
        niche: 'Excel for accountants',
        audience: 'accountants',
        ...proposal,
        pillars: ['Formulas'],
        color: 'olive',
        formats: [{ platform: 'youtube', ...DEFAULT_FORMATS.youtube }],
        voiceId: 'mock-voice',
        sponsorDial: 0.3,
        episodesPerWeek: 2,
        timezone: TIMEZONE,
      })
    ).rejects.toThrow('Give 3 to 5 content pillars, comma separated.')
    expect((await t.query(api.private.onboarding.start, {})).roster).toEqual([])
  })
})
