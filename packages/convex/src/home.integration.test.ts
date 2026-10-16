import { waitsOnOperator } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import { setup } from '../test/setup'

describe('home overview', () => {
  it('answers what waits, what changed on its own this week, and what each persona earned', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, { appUrl: 'http://localhost:3300' })
    await t.finishAllScheduledFunctions(() => {})
    const overview = await t.query(api.private.home.overview, {})

    // Every episode that waits on the operator or failed is counted; the soonest few are named.
    const personas = await t.query(api.private.personas.list, {})
    const expected = personas.reduce((sum, persona) => sum + persona.counts.waitsOnOperator + persona.counts.failed, 0)
    expect(overview.waits.episodeCount).toBe(expected)
    expect(overview.waits.episodes.length).toBe(Math.min(4, expected))
    expect(overview.waits.episodes.every((episode) => waitsOnOperator(episode.status) || episode.status === 'failed')).toBe(true)
    expect(overview.waits.checklist).toBe((await t.query(api.private.checklist.list, {})).filter((item) => item.status === 'open').length)
    expect(overview.waits.replies).toEqual([expect.objectContaining({ persona: expect.objectContaining({ name: 'Ada Automates' }) })])

    // Ada's seeded review six days ago moved pillar weight: a change the analyst made on its own this week.
    expect(overview.changes.count).toBeGreaterThan(0)
    expect(overview.changes.entries.every((entry) => entry.actor !== 'operator')).toBe(true)
    expect(overview.changes.entries.map((entry) => entry.createdAt)).toEqual(
      overview.changes.entries.map((entry) => entry.createdAt).sort((a, b) => b - a)
    )

    // The earnings are the workspace report's rows.
    const report = await t.query(api.private.report.forWorkspace, {})
    expect(overview.earned.personas.map((row) => [row.persona.name, row.value])).toEqual(
      report.personas.map((row) => [row.persona.name, row.funnel.value])
    )
    expect(overview.earned.total).toBe(report.total.value)
  })
})
