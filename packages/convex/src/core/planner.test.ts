import { describe, expect, it } from 'vitest'
import { pillarWeights, type PlatformFormat } from '@influstep/shared'
import { planPostSlots, planWeek } from './planner'

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
    cadence: { postsPerDay: 1, kinds: ['text'], intents: ['teach'] },
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
      now: Date.UTC(2026, 9, 13),
    })
    // Six of a in the last 28 days: b catches up first and ends with 3 of the 13. Without the history, or with
    // the August post counted, b would get 2.
    expect(posts).toHaveLength(7)
    expect(posts.filter((post) => post.pillar === 'b')).toHaveLength(3)
  })
})
