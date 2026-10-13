import {
  DEFAULT_FORMATS,
  DELIVERIES,
  LENGTH_SEC_MAX,
  LENGTH_SEC_MIN,
  PUBLICATION_BODY_MAX,
  SPONSOR_SEGMENTS,
  effectiveStyle,
  hookOf,
  lengthProblem,
  scriptProblems,
  type Delivery,
  type PlatformFormat,
  type SponsorSegment,
} from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import type { Doc, Id } from './_generated/dataModel'
import { addDays, dayKey, weekStart } from './core/dates'
import { createIdea } from './core/episodes'
import type { ScriptBrief } from './providers/llm'
import { mockLlm } from './providers/llm/mock'
import { writeScriptsDueBefore } from '../test/scripts'
import { setup } from '../test/setup'

const TIMEZONE = 'Europe/Oslo'
const SPONSOR = 'Formstep'

/** Each delivery at the length a persona of that kind typically runs. */
const TYPICAL_LENGTH: Record<Delivery, number> = { talking_head: 35, screen_with_avatar: 300, screen_only: 60 }

const TALKING_HEAD: PlatformFormat = { platform: 'tiktok', ...DEFAULT_FORMATS.tiktok }
const SCREEN_WITH_AVATAR: PlatformFormat = { platform: 'youtube', ...DEFAULT_FORMATS.youtube, lengthSec: 90 }

type Test = ReturnType<typeof setup>

function scriptBrief(args: { delivery: Delivery; sponsorSegment: SponsorSegment; lengthSec: number }): ScriptBrief {
  return {
    persona: {
      name: 'Ada Automates',
      handle: 'ada.automates',
      niche: 'automation for small teams',
      tone: 'plain',
      bible: 'Ada says the point first.',
      pillars: ['n8n tutorials'],
    },
    concept: 'React to: n8n webhooks that retry',
    pillar: 'n8n tutorials',
    sponsorSegment: args.sponsorSegment,
    sponsorName: SPONSOR,
    sponsorUrl: 'https://formstep.io',
    // An empty memory and the catalog control on every dimension: the brief of a persona that has tested nothing yet.
    memory: { goal: 'Paying Formstep customers', standing: null, rules: [], facts: [], learnings: [] },
    style: effectiveStyle({ sponsorSegment: args.sponsorSegment }, undefined),
    styleLines: [],
    directives: ['focus on n8n error handling for two weeks'],
    signals: [{ title: 'n8n webhooks that retry', summary: 'People ask how.', url: 'https://news.ycombinator.com/item?id=1' }],
    format: { lengthSec: args.lengthSec, delivery: args.delivery, hookNotes: ['Hook in the first two seconds.'] },
    problems: [],
    // No morning sweep has run for this persona yet.
    research: { brief: null, problems: [] },
  }
}

/** A workspace and one persona with a single format, inserted directly so the test owns every row it reads. */
async function persona(t: Test, format: PlatformFormat): Promise<Id<'personas'>> {
  return t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert('workspaces', {
      name: 'Test',
      sponsorName: SPONSOR,
      sponsorUrl: 'https://formstep.io',
      appUrl: 'http://localhost:3300',
      signInRequiredHosts: [],
      signedInHosts: [],
      valuePerPaid: 29,
      currency: 'EUR',
    })
    return ctx.db.insert('personas', {
      workspaceId,
      name: 'Ada Automates',
      color: 'iris',
      handle: 'ada.automates',
      niche: 'automation for small teams',
      tone: 'plain',
      bio: 'One automation a day.',
      bible: 'Ada says the point first and never says "guys".',
      pillars: ['n8n tutorials', 'AI agent workflows'],
      formats: [format],
      voiceId: 'mock-ada',
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

/** One video idea for next week, through the writer's job as the due-script pass queues it the morning before. */
async function writtenVideo(t: Test, personaId: Id<'personas'>, sponsorSegment: SponsorSegment): Promise<Doc<'episodes'>> {
  const plannedFor = addDays(weekStart(dayKey(Date.now(), TIMEZONE)), 7)
  const episodeId = await t.run(async (ctx) => {
    const owner = await ctx.db.get(personaId)
    if (!owner) throw new Error('the persona is gone')
    return createIdea(ctx, owner, {
      personaId,
      plannedFor,
      concept: 'n8n webhooks that retry',
      pillar: 'n8n tutorials',
      sponsorSegment,
      signalIds: [],
      kind: 'video',
    })
  })
  await t.finishAllScheduledFunctions(() => {})
  expect((await t.run((ctx) => ctx.db.get(episodeId)))?.status).toBe('idea')
  await writeScriptsDueBefore(t, personaId, plannedFor)
  const episode = await t.run((ctx) => ctx.db.get(episodeId))
  if (!episode) throw new Error('the episode is gone')
  expect(episode.status).toBe('scripted')
  return episode
}

function beatsOf(episode: Doc<'episodes'>): NonNullable<Doc<'episodes'>['shotPlan']> {
  if (!episode.shotPlan) throw new Error(`episode ${episode._id} is scripted without beats`)
  return episode.shotPlan
}

describe('the mock writer', () => {
  it('writes beats that pass the script rules for every sponsor segment and delivery, from the shortest format to the longest', async () => {
    for (const delivery of DELIVERIES) {
      for (const sponsorSegment of SPONSOR_SEGMENTS) {
        for (const lengthSec of [LENGTH_SEC_MIN, TYPICAL_LENGTH[delivery], LENGTH_SEC_MAX]) {
          const label = `${delivery}, ${sponsorSegment}, ${lengthSec} s`
          const draft = await mockLlm.writeScript(scriptBrief({ delivery, sponsorSegment, lengthSec }))
          expect(scriptProblems(draft.shotPlan, { sponsorSegment, sponsorName: SPONSOR }), label).toEqual([])
          expect(lengthProblem(draft.shotPlan, lengthSec), label).toBeNull()
          expect(draft.description.trim(), label).not.toBe('')
          // The first beat says the hook alone.
          expect(draft.shotPlan[0]?.voiceover, label).toBe(hookOf(draft.shotPlan))
        }
      }
    }
  })

  it('keeps the directives out of the description, so a directive with a link or a long one never fails a script', async () => {
    const linked = 'Always link www.n8n.io in episodes'
    const long = `Always ${'explain the retry settings in full '.repeat(50)}`
    expect(Array.from(long).length).toBeGreaterThan(PUBLICATION_BODY_MAX)
    for (const directive of [linked, long]) {
      for (const sponsorSegment of SPONSOR_SEGMENTS) {
        const brief = { ...scriptBrief({ delivery: 'talking_head', sponsorSegment, lengthSec: 35 }), directives: [directive] }
        const draft = await mockLlm.writeScript(brief)
        // The writer's own checks on a description: no link (the footer adds the tracked one) and within the body's limit.
        expect(draft.description, sponsorSegment).not.toMatch(/https?:\/\/|www\./i)
        expect(Array.from(draft.description).length, sponsorSegment).toBeLessThanOrEqual(PUBLICATION_BODY_MAX)
        expect(draft.description, sponsorSegment).not.toContain(directive)
      }
    }
  })

  it('shapes the beats by the delivery and closes the last one on the call to action', async () => {
    const talking = await mockLlm.writeScript(scriptBrief({ delivery: 'talking_head', sponsorSegment: 'demo', lengthSec: 35 }))
    expect(talking.shotPlan.map((beat) => beat.tool)).toEqual(['presenter', 'presenter', SPONSOR])
    expect(talking.shotPlan.at(-1)?.voiceover.endsWith('follow for the next one.')).toBe(true)

    const avatar = await mockLlm.writeScript(scriptBrief({ delivery: 'screen_with_avatar', sponsorSegment: 'mention', lengthSec: 90 }))
    expect(avatar.shotPlan.map((beat) => beat.tool)).toEqual(['presenter', 'n8n'])
    expect(avatar.shotPlan.at(-1)?.voiceover).toContain(`sponsored by ${SPONSOR}`)

    const screen = await mockLlm.writeScript(scriptBrief({ delivery: 'screen_only', sponsorSegment: 'none', lengthSec: 60 }))
    expect(screen.shotPlan.map((beat) => beat.tool)).toEqual(['browser', 'n8n'])
    expect(screen.shotPlan.at(-1)?.voiceover.endsWith('Follow Ada Automates for more n8n tutorials.')).toBe(true)
  })
})

describe('the writer stores the beats as the script', () => {
  it('stores the hook as the first sentence of the first beat, and the description', async () => {
    const t = setup()
    const personaId = await persona(t, TALKING_HEAD)
    const episode = await writtenVideo(t, personaId, 'none')
    const beats = beatsOf(episode)
    expect(episode.hook).toBe(hookOf(beats))
    expect(episode.hook).not.toBe('')
    expect(episode.description?.trim()).not.toBe('')
    expect(scriptProblems(beats, { sponsorSegment: 'none', sponsorName: SPONSOR })).toEqual([])
    expect(episode.shots.map((shot) => shot.voiceover)).toEqual(beats.map((beat) => beat.voiceover))
  })

  it('opens a screen-with-avatar episode on the presenter speaking the first beat', async () => {
    const t = setup()
    const personaId = await persona(t, SCREEN_WITH_AVATAR)
    const episode = await writtenVideo(t, personaId, 'none')
    const beats = beatsOf(episode)
    const [first] = episode.shots
    expect(first?.kind).toBe('avatar')
    expect(first?.voiceover).toBe(beats[0]?.voiceover)
    expect(first?.voiceover.startsWith(episode.hook)).toBe(true)
    expect(episode.shots.slice(1).every((shot) => shot.kind === 'screen')).toBe(true)
  })

  it('speaks the sponsor in a sponsored episode and never in one without a sponsor', async () => {
    const t = setup()
    const avatarPersona = await persona(t, SCREEN_WITH_AVATAR)
    const speaksSponsor = (episode: Doc<'episodes'>) =>
      episode.shots.some((shot) => shot.voiceover.toLowerCase().includes(SPONSOR.toLowerCase()))

    const mention = await writtenVideo(t, avatarPersona, 'mention')
    expect(speaksSponsor(mention)).toBe(true)

    // A demo is its own beat on the sponsor's site, recorded as a screen.
    const demo = await writtenVideo(t, avatarPersona, 'demo')
    expect(speaksSponsor(demo)).toBe(true)
    const demoShot = demo.shots.find((shot) => shot.title === `${SPONSOR} demo`)
    expect(demoShot?.kind).toBe('screen')

    const none = await writtenVideo(t, avatarPersona, 'none')
    expect(speaksSponsor(none)).toBe(false)
  })
})
