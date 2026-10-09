import { describe, expect, it } from 'vitest'
import { planWeek } from './planner'

const persona = {
  pillars: ['n8n tutorials', 'AI agents', 'automation fails'],
  sponsorDial: 0.5,
  sponsorRampEpisodes: 0,
  episodesPerWeek: 4,
  episodeCount: 0,
}

describe('planWeek', () => {
  it('fills the cadence, skipping taken days', () => {
    const plan = planWeek({ weekStart: '2026-10-12', persona, signals: [], takenDays: ['2026-10-13'] })
    expect(plan.map((episode) => episode.plannedFor)).toEqual(['2026-10-14', '2026-10-15', '2026-10-17'])
  })

  it('keeps a new persona unsponsored during the ramp', () => {
    const plan = planWeek({ weekStart: '2026-10-12', persona: { ...persona, sponsorRampEpisodes: 10 }, signals: [], takenDays: [] })
    expect(plan.every((episode) => episode.sponsorSegment === 'none')).toBe(true)
  })

  it('sponsors about the dial share once past the ramp', () => {
    const plan = planWeek({ weekStart: '2026-10-12', persona: { ...persona, episodeCount: 20 }, signals: [], takenDays: [] })
    const sponsored = plan.filter((episode) => episode.sponsorSegment !== 'none')
    expect(sponsored).toHaveLength(2)
  })

  it('reacts to the strongest signals first and balances variants', () => {
    const plan = planWeek({
      weekStart: '2026-10-12',
      persona,
      signals: [
        { id: 'weak', title: 'weak', score: 10, topics: ['agents'] },
        { id: 'strong', title: 'strong', score: 90, topics: ['n8n'] },
      ],
      experiment: { id: 'exp', variantKeys: ['control', 'wrong'], assigned: { control: 1 } },
      takenDays: [],
    })
    expect(plan[0]?.signalId).toBe('strong')
    expect(plan[0]?.pillar).toBe('n8n tutorials')
    expect(plan.map((episode) => episode.variantKey)).toEqual(['wrong', 'control', 'wrong', 'control'])
  })
})
