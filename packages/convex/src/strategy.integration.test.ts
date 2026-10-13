import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { addDays, dayKey, weekStart } from './core/dates'
import { createIdea } from './core/episodes'
import { mockLlm } from './providers/llm/mock'
import type { ScriptBrief } from './providers/llm'
import { TIMEZONE, insertMeasuredVideo, insertPersona } from '../test/fixtures'
import { writeScriptsDueBefore } from '../test/scripts'
import { setup } from '../test/setup'

const DAY = 24 * 60 * 60 * 1000

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the strategy loop', () => {
  it('starts an experiment from the review, decides it on the numbers, and writes the next script to the winner', async () => {
    const t = setup()
    const personaId: Id<'personas'> = await t.run(async (ctx) => (await insertPersona(ctx))._id)

    // The review as the operator asks for it, through the job queue and dispatch.
    const jobId = await t.mutation(api.private.strategy.reviewNow, { personaId })
    await expect(t.mutation(api.private.strategy.reviewNow, { personaId })).rejects.toThrow(
      'Ada Automates is already reviewing the strategy.'
    )
    await t.finishAllScheduledFunctions(() => {})
    const job = await t.run((ctx) => ctx.db.get(jobId))
    expect(job?.status).toBe('done')
    const experiment = await t.run(async (ctx) =>
      ctx.db
        .query('experiments')
        .withIndex('by_persona_status', (q) => q.eq('personaId', personaId).eq('status', 'running'))
        .unique()
    )
    if (!experiment) throw new Error('the review started no experiment')
    expect(experiment).toMatchObject({ name: 'Hook style: Question vs How to', metric: 'follows', createdBy: 'analyst' })
    expect(job?.result).toEqual({ changes: 1, goalNoteId: expect.any(String), startedExperimentId: experiment._id })

    // Two videos of each variant, measured: the question opens get four times the follows per view.
    await t.run(async (ctx) => {
      const persona = await ctx.db.get(personaId)
      if (!persona) throw new Error('persona vanished')
      const now = Date.now()
      for (const [index, variantKey] of ['howto', 'question', 'howto', 'question'].entries()) {
        await insertMeasuredVideo(ctx, persona, {
          publishedAt: now - (8 - index) * DAY,
          views: 1500,
          clicks: 10,
          follows: variantKey === 'question' ? 60 : 15,
          experimentId: experiment._id,
          variantKey,
        })
      }
    })
    expect(await t.mutation(internal.internal.agents.evaluateExperimentsMutation, { personaId })).toEqual({ decided: 1 })
    const persona = await t.run((ctx) => ctx.db.get(personaId))
    expect(persona?.strategy?.defaults).toEqual([expect.objectContaining({ kind: 'hook', key: 'question', experimentId: experiment._id })])
    const learning = 'Hook style: "Question" beat "How to" on follows per view, 4.00% against 1.00% over 6,000 views, 99% confidence.'

    // The next idea is written to the winner: the brief carries the learning and the style line, and the hook asks.
    const briefs: ScriptBrief[] = []
    const write = mockLlm.writeScript.bind(mockLlm)
    vi.spyOn(mockLlm, 'writeScript').mockImplementation(async (brief) => {
      briefs.push(brief)
      return write(brief)
    })
    const plannedFor = addDays(weekStart(dayKey(Date.now(), TIMEZONE)), 7)
    const episodeId = await t.run(async (ctx) => {
      const owner = await ctx.db.get(personaId)
      if (!owner) throw new Error('persona vanished')
      return createIdea(ctx, owner, {
        personaId,
        plannedFor,
        concept: 'n8n webhooks that retry',
        pillar: 'n8n tutorials',
        sponsorSegment: 'none',
        signalIds: [],
        kind: 'video',
      })
    })
    const context = await t.query(internal.internal.data.getEpisodeContext, { episodeId })
    expect(context.memory.learnings).toEqual([learning])
    // Written the morning before it goes out.
    await t.finishAllScheduledFunctions(() => {})
    expect(briefs).toEqual([])
    await writeScriptsDueBefore(t, personaId, plannedFor)
    const [brief] = briefs
    expect(brief?.memory.learnings).toEqual([learning])
    expect(brief?.styleLines).toEqual(['Hook style: Open with the question the viewer has.'])
    const episode = await t.run((ctx) => ctx.db.get(episodeId))
    expect(episode?.status).toBe('scripted')
    expect(episode?.hook).toMatch(/^Why does /)
  })

  it('reviews every active persona from the weekly cron', async () => {
    const t = setup()
    const [active, paused] = await t.run(async (ctx) => {
      const first = await insertPersona(ctx)
      const second = await insertPersona(ctx, { name: 'Max Ships', handle: 'max.ships' })
      await ctx.db.patch(second._id, { paused: true })
      return [first._id, second._id]
    })
    await t.mutation(internal.internal.schedule.reviewStrategies, {})
    await t.finishAllScheduledFunctions(() => {})
    // A query result cannot carry undefined, so the test asks whether each persona was reviewed.
    const reviewed = await t.run(async (ctx) =>
      Promise.all([active, paused].map(async (id) => (await ctx.db.get(id))?.strategy?.reviewedAt !== undefined))
    )
    expect(reviewed).toEqual([true, false])
  })
})

describe('the seeded strategy', () => {
  it('gives Ada a reviewed strategy with a decided call to action, and Max none', async () => {
    const t = setup()
    await t.action(internal.internal.seed.run, {})
    const seeded = await t.run(async (ctx) => {
      const personas = await ctx.db.query('personas').collect()
      const ada = personas.find((persona) => persona.handle === 'ada.automates')
      const max = personas.find((persona) => persona !== ada)
      if (!ada || !max) throw new Error('the seed has no Ada and Max')
      const journal = await ctx.db
        .query('journal')
        .withIndex('by_persona_time', (q) => q.eq('personaId', ada._id))
        .collect()
      const active = async (personaId: Id<'personas'>) =>
        ctx.db
          .query('memories')
          .withIndex('by_persona_status', (q) => q.eq('personaId', personaId).eq('status', 'active'))
          .collect()
      const adaMemories = await active(ada._id)
      return {
        ada,
        max,
        journalKinds: journal.map((entry) => entry.kind),
        learnings: adaMemories
          .filter((memory) => memory.kind === 'learning')
          .map((memory) => memory.text)
          .sort(),
        // Beside the learnings: the review's goal note, the operator's fact and rule, and the morning's
        // research (a brief and the one repeated question).
        others: adaMemories
          .filter((memory) => memory.kind !== 'learning')
          .map((memory) => memory.kind)
          .sort(),
        maxMemories: (await active(max._id)).length,
      }
    })
    expect(seeded.ada.strategy?.defaults.map((entry) => [entry.kind, entry.key])).toEqual([['cta', 'comment']])
    expect(seeded.ada.strategy?.reviewedAt).toEqual(expect.any(Number))
    expect(seeded.ada.strategy?.pillarWeights.length).toBe(seeded.ada.pillars.length)
    expect(seeded.journalKinds).toEqual(expect.arrayContaining(['experiment_started', 'experiment_decided', 'pillar_weights']))
    expect(seeded.learnings).toEqual([
      expect.stringMatching(/^Call to action: "Comment" beat "Follow" on clicks per view/),
      expect.stringMatching(/^Over the last 28 days .* So ".*" gets \d+% of the evergreen plan/),
    ])
    expect(seeded.others).toEqual(['brief', 'fact', 'goal_note', 'problem', 'rule', 'rule'])
    expect(seeded.max.strategy).toBeUndefined()
    expect(seeded.maxMemories).toBe(0)
  })
})
