import type { Platform } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import type { Doc, Id } from '../_generated/dataModel'
import { buildFunnel, countConversions, hookGroup, rankGroups, sumFunnels, type VideoOutcome } from './report'

describe('countConversions', () => {
  it('counts each kind, the code share of paid, and the estimated value', () => {
    const out = countConversions(
      [
        { kind: 'demo_started', via: 'utm', mock: false },
        { kind: 'signup', via: 'utm', mock: false },
        { kind: 'trial_started', via: 'utm', mock: false },
        { kind: 'paid', via: 'utm', mock: false },
        { kind: 'paid', via: 'code', mock: false },
      ],
      29
    )
    expect(out).toEqual({ demos: 1, signups: 1, trials: 1, paid: 2, paidViaCode: 1, value: 58 })
  })
})

const SNAPSHOT_BASE = { _creationTime: 0, personaId: 'p' as Id<'personas'>, takenAt: 1, mock: false }

function snapshot(publicationId: string, platform: Platform, counts: Partial<Doc<'metricSnapshots'>['counts']>): Doc<'metricSnapshots'> {
  return {
    ...SNAPSHOT_BASE,
    _id: `s-${publicationId}` as Id<'metricSnapshots'>,
    publicationId: publicationId as Id<'publications'>,
    platform,
    counts: { views: 0, watchRate: 0, follows: 0, likes: 0, comments: 0, clicks: 0, signups: 0, paid: 0, ...counts },
  }
}

describe('buildFunnel', () => {
  it('weighs the watch rate by views on the platforms that report one, never X', () => {
    const funnel = buildFunnel({
      snapshots: [
        snapshot('a', 'youtube', { views: 100, watchRate: 0.5, likes: 4, comments: 1 }),
        snapshot('b', 'tiktok', { views: 300, watchRate: 0.3, likes: 6, comments: 2 }),
        snapshot('c', 'x', { views: 1000, watchRate: 0 }),
      ],
      clicks: 0,
      conversions: [],
      valuePerPaid: 29,
    })
    expect(funnel).toMatchObject({ views: 1400, likes: 10, comments: 3, watchedViews: 400 })
    expect(funnel.watchRate).toBeCloseTo(0.35)
  })

  it('has no watch rate with no views where one is reported', () => {
    const funnel = buildFunnel({ snapshots: [snapshot('c', 'x', { views: 50 })], clicks: 0, conversions: [], valuePerPaid: 29 })
    expect(funnel.watchRate).toBeNull()
  })
})

describe('sumFunnels', () => {
  it('adds the personas up and weighs their watch rates by the views they were read over', () => {
    const ada = buildFunnel({
      snapshots: [snapshot('a', 'youtube', { views: 100, watchRate: 0.6, follows: 2 })],
      clicks: 5,
      conversions: [{ kind: 'paid', via: 'code', mock: false }],
      valuePerPaid: 29,
    })
    const max = buildFunnel({
      snapshots: [snapshot('b', 'tiktok', { views: 300, watchRate: 0.2, follows: 9 }), snapshot('c', 'x', { views: 40 })],
      clicks: 7,
      conversions: [],
      valuePerPaid: 29,
    })
    const total = sumFunnels([ada, max])
    expect(total).toMatchObject({ views: 440, follows: 11, clicks: 12, paid: 1, paidViaCode: 1, value: 29, watchedViews: 400, mock: false })
    expect(total.watchRate).toBeCloseTo(0.3)
  })

  it('has no watch rate when no persona has one', () => {
    expect(sumFunnels([]).watchRate).toBeNull()
  })
})

function outcome(id: string, episode: Partial<Doc<'episodes'>>, numbers: { views: number; clicks: number; paid: number }): VideoOutcome {
  return { episode: { _id: id as Id<'episodes'>, ...episode } as Doc<'episodes'>, ...numbers, value: numbers.paid * 29 }
}

describe('rankGroups', () => {
  const byPillar = (episode: Doc<'episodes'>) => (episode.pillar === undefined ? null : { key: episode.pillar, label: episode.pillar })

  it('ranks by value per video, so a group is not ahead for having more videos', () => {
    const groups = rankGroups(
      [
        outcome('1', { pillar: 'n8n' }, { views: 1000, clicks: 10, paid: 1 }),
        outcome('2', { pillar: 'n8n' }, { views: 1000, clicks: 10, paid: 1 }),
        outcome('3', { pillar: 'n8n' }, { views: 1000, clicks: 10, paid: 0 }),
        outcome('4', { pillar: 'agents' }, { views: 1000, clicks: 10, paid: 1 }),
      ],
      byPillar
    )
    expect(groups.map((group) => [group.key, group.videos, group.value, group.valuePerVideo])).toEqual([
      ['agents', 1, 29, 29],
      ['n8n', 3, 58, 58 / 3],
    ])
    expect(groups[1]?.episodeIds).toEqual(['1', '2', '3'])
  })

  it('breaks a tie on value with clicks per view, and leaves out a video in no group', () => {
    const groups = rankGroups(
      [
        outcome('1', { pillar: 'n8n' }, { views: 1000, clicks: 10, paid: 0 }),
        outcome('2', { pillar: 'agents' }, { views: 1000, clicks: 20, paid: 0 }),
        outcome('3', {}, { views: 1000, clicks: 90, paid: 0 }),
      ],
      byPillar
    )
    expect(groups.map((group) => [group.key, group.clicksPerView])).toEqual([
      ['agents', 0.02],
      ['n8n', 0.01],
    ])
  })
})

describe('hookGroup', () => {
  it('names a catalog style as the catalog does, whatever an experiment called it', () => {
    expect(hookGroup({ hookStyle: { key: 'wrong', label: 'I was wrong about…' } })).toEqual({ key: 'wrong', label: 'Confession' })
  })

  it("keeps an operator's own style under its own label, and has no group without a style", () => {
    expect(hookGroup({ hookStyle: { key: 'dare', label: 'A dare' } })).toEqual({ key: 'dare', label: 'A dare' })
    expect(hookGroup({})).toBeNull()
  })
})
