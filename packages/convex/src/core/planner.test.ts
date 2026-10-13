import { describe, expect, it } from 'vitest'
import { pillarWeights, type PlatformFormat, type XCadence } from '@influstep/shared'
import { planPostSlots, planWeek, type PostKindPlan } from './planner'

const persona = {
  pillars: ['n8n tutorials', 'AI agents', 'automation fails'],
  sponsorDial: 0.5,
  sponsorRampEpisodes: 0,
  episodesPerWeek: 4,
  episodeCount: 0,
}

const equal = { pillarWeights: pillarWeights(persona.pillars, undefined), priorCounts: {} }

describe('planWeek', () => {
  it('fills the cadence, skipping taken days', () => {
    const plan = planWeek({ weekStart: '2026-10-12', persona, ...equal, signals: [], takenDays: ['2026-10-13'] })
    expect(plan.map((episode) => episode.plannedFor)).toEqual(['2026-10-14', '2026-10-15', '2026-10-17'])
  })

  it('keeps a new persona unsponsored during the ramp', () => {
    const plan = planWeek({
      weekStart: '2026-10-12',
      persona: { ...persona, sponsorRampEpisodes: 10 },
      ...equal,
      signals: [],
      takenDays: [],
    })
    expect(plan.every((episode) => episode.sponsorSegment === 'none')).toBe(true)
  })

  it('sponsors about the dial share once past the ramp', () => {
    const plan = planWeek({ weekStart: '2026-10-12', persona: { ...persona, episodeCount: 20 }, ...equal, signals: [], takenDays: [] })
    const sponsored = plan.filter((episode) => episode.sponsorSegment !== 'none')
    expect(sponsored).toHaveLength(2)
  })

  it('reacts to the strongest signals first and balances variants', () => {
    const plan = planWeek({
      weekStart: '2026-10-12',
      persona,
      ...equal,
      signals: [
        { id: 'weak', title: 'weak', score: 10, topics: ['agents'] },
        { id: 'strong', title: 'strong', score: 90, topics: ['n8n'] },
      ],
      experiment: { id: 'exp', kind: 'hook', variantKeys: ['control', 'wrong'], assigned: { control: 1 } },
      takenDays: [],
    })
    expect(plan[0]?.signalId).toBe('strong')
    expect(plan[0]?.pillar).toBe('n8n tutorials')
    expect(plan.map((episode) => episode.variantKey)).toEqual(['wrong', 'control', 'wrong', 'control'])
  })

  it('shares the evergreen slots out by weight, counting the episodes the pillars already had', () => {
    const weights = [
      { pillar: 'n8n tutorials', weight: 0.5 },
      { pillar: 'AI agents', weight: 0.3 },
      { pillar: 'automation fails', weight: 0.2 },
    ]
    const fresh = planWeek({ weekStart: '2026-10-12', persona, pillarWeights: weights, priorCounts: {}, signals: [], takenDays: [] })
    expect(fresh.map((episode) => episode.pillar)).toEqual(['n8n tutorials', 'AI agents', 'automation fails', 'n8n tutorials'])
    // Four weeks of n8n tutorials already: the other pillars catch up first.
    const caughtUp = planWeek({
      weekStart: '2026-10-12',
      persona,
      pillarWeights: weights,
      priorCounts: { 'n8n tutorials': 8, 'AI agents': 2, 'automation fails': 0 },
      signals: [],
      takenDays: [],
    })
    expect(caughtUp.map((episode) => episode.pillar)).toEqual(['automation fails', 'AI agents', 'automation fails', 'AI agents'])
  })

  it('counts this week’s reactive slots toward their pillar before sharing out the evergreen ones', () => {
    const plan = planWeek({
      weekStart: '2026-10-12',
      persona,
      ...equal,
      signals: [{ id: 'strong', title: 'strong', score: 90, topics: ['n8n'] }],
      takenDays: [],
    })
    expect(plan.map((episode) => episode.pillar)).toEqual(['n8n tutorials', 'AI agents', 'automation fails', 'n8n tutorials'])
  })

  it('gives a sponsor experiment’s variants only to sponsored slots', () => {
    const plan = planWeek({
      weekStart: '2026-10-12',
      persona: { ...persona, episodeCount: 20 },
      ...equal,
      signals: [],
      experiment: { id: 'exp', kind: 'sponsor', variantKeys: ['end', 'early'], assigned: {} },
      takenDays: [],
    })
    for (const episode of plan) {
      expect(episode.variantKey !== undefined, episode.plannedFor).toBe(episode.sponsorSegment !== 'none')
      expect(episode.experimentId !== undefined, episode.plannedFor).toBe(episode.sponsorSegment !== 'none')
    }
    expect(plan.flatMap((episode) => (episode.variantKey === undefined ? [] : [episode.variantKey]))).toEqual(['end', 'early'])
  })

  it('gives every other kind’s variants to every slot', () => {
    const plan = planWeek({
      weekStart: '2026-10-12',
      persona: { ...persona, episodeCount: 20 },
      ...equal,
      signals: [],
      experiment: { id: 'exp', kind: 'cta', variantKeys: ['follow', 'comment'], assigned: {} },
      takenDays: [],
    })
    expect(plan.map((episode) => episode.variantKey)).toEqual(['follow', 'comment', 'follow', 'comment'])
  })
})

describe('planPostSlots', () => {
  const format: PlatformFormat = {
    platform: 'x',
    lengthSec: 0,
    aspect: '16:9',
    delivery: 'screen_only',
    hookNote: '',
    publishHour: 9,
    cadence: { postsPerDay: 1, kinds: ['text'], intents: ['teach'], repliesPerDay: 5 },
  }

  it('shares the post slots out by the persona’s weights, counting its recent posts', () => {
    const posts = planPostSlots({
      weekStart: '2026-10-19',
      persona: {
        pillars: ['a', 'b'],
        sponsorDial: 0,
        sponsorRampEpisodes: 0,
        timezone: 'UTC',
        voice: undefined,
        strategy: {
          pillarWeights: [
            { pillar: 'a', weight: 0.75 },
            { pillar: 'b', weight: 0.25 },
          ],
          defaults: [],
        },
      },
      format,
      posts: [
        ...['01', '02', '03', '04', '05', '06'].map((day) => ({ plannedFor: `2026-10-${day}`, kind: 'text' as const, pillar: 'a' })),
        // Older than 28 days: no longer counts toward a's share.
        { plannedFor: '2026-08-01', kind: 'text', pillar: 'b' },
      ],
      episodeCount: 0,
      signals: [],
      postKinds: { mode: 'default', key: 'rotate' },
      now: Date.UTC(2026, 9, 13),
    })
    // Six of a in the last 28 days: b catches up first and ends with 3 of the 13. Without the history, or with
    // the August post counted, b would get 2.
    expect(posts).toHaveLength(7)
    expect(posts.filter((post) => post.pillar === 'b')).toHaveLength(3)
  })

  const mixedCadence = { postsPerDay: 3, kinds: ['text', 'image', 'thread'], intents: ['teach'], repliesPerDay: 5 } satisfies XCadence
  const mixed: PlatformFormat = { ...format, cadence: mixedCadence }
  const plainPersona = {
    pillars: ['a'],
    sponsorDial: 0,
    sponsorRampEpisodes: 0,
    timezone: 'UTC',
    voice: undefined,
    strategy: { pillarWeights: [], defaults: [] },
  }
  const week = (postKinds: PostKindPlan, slotFormat = mixed) =>
    planPostSlots({
      weekStart: '2026-10-19',
      persona: plainPersona,
      format: slotFormat,
      posts: [],
      episodeCount: 0,
      signals: [],
      postKinds,
      now: Date.UTC(2026, 9, 13),
    })

  it('gives a post kind experiment’s variants to the single posts, balanced, and none to a thread', () => {
    const posts = week({ mode: 'experiment', id: 'exp', variantKeys: ['rotate', 'image'], assigned: { rotate: 2 } })
    const singles = posts.filter((post) => post.kind !== 'thread')
    expect(singles.length).toBeGreaterThan(4)
    for (const post of posts.filter((candidate) => candidate.kind === 'thread')) {
      expect(post.experimentId).toBeUndefined()
      expect(post.variantKey).toBeUndefined()
    }
    for (const post of singles) expect(post.experimentId).toBe('exp')
    // Image posts are every single post of the image variant; rotate keeps alternating text and image.
    for (const post of singles.filter((candidate) => candidate.variantKey === 'image')) expect(post.kind).toBe('image')
    const count = (key: string) => singles.filter((post) => post.variantKey === key).length
    expect(Math.abs(count('rotate') + 2 - count('image'))).toBeLessThanOrEqual(1)
    expect(singles.slice(0, 2).map((post) => post.variantKey)).toEqual(['image', 'image'])
  })

  it('makes every single post the kind a decided default names, unless the cadence lacks it', () => {
    const texts = week({ mode: 'default', key: 'text' })
    expect(new Set(texts.filter((post) => post.kind !== 'thread').map((post) => post.kind))).toEqual(new Set(['text']))
    for (const post of texts) expect(post.variantKey).toBeUndefined()

    const rotated = week({ mode: 'default', key: 'rotate' })
    expect(new Set(rotated.filter((post) => post.kind !== 'thread').map((post) => post.kind))).toEqual(new Set(['text', 'image']))

    // The operator's cadence holds no image posts, so an image default cannot be honored: the posts rotate.
    const noImages = week({ mode: 'default', key: 'image' }, { ...mixed, cadence: { ...mixedCadence, kinds: ['text', 'thread'] } })
    expect(noImages.some((post) => post.kind === 'image')).toBe(false)
  })
})
