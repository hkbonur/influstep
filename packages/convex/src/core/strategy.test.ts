import { EXPERIMENT_CATALOG, type ExperimentKind } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { TIMEZONE, insertEpisode, insertMeasuredVideo, insertPersona } from '../../test/fixtures'
import { setup } from '../../test/setup'
import { addDays, dayKey, instantAt } from './dates'
import { applyExperimentDecision, startExperiment, stopExperiment } from './experiments'
import { goalNoteText, reviewStrategy } from './strategy'

const DAY = 24 * 60 * 60 * 1000

async function reload(ctx: MutationCtx, personaId: Id<'personas'>): Promise<Doc<'personas'>> {
  const persona = await ctx.db.get(personaId)
  if (!persona) throw new Error('persona vanished')
  return persona
}

async function journalOf(ctx: MutationCtx, personaId: Id<'personas'>): Promise<Doc<'journal'>[]> {
  return ctx.db
    .query('journal')
    .withIndex('by_persona_time', (q) => q.eq('personaId', personaId))
    .collect()
}

async function memoriesOf(ctx: MutationCtx, personaId: Id<'personas'>, kind: Doc<'memories'>['kind']): Promise<Doc<'memories'>[]> {
  const rows = await ctx.db
    .query('memories')
    .withIndex('by_persona_kind_status', (q) => q.eq('personaId', personaId).eq('kind', kind))
    .collect()
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

async function messagesOf(ctx: MutationCtx, personaId: Id<'personas'>): Promise<string[]> {
  const messages = await ctx.db
    .query('messages')
    .withIndex('by_persona', (q) => q.eq('personaId', personaId))
    .collect()
  return messages.map((message) => message.text)
}

/** Two variants of a dimension from the catalog, the first as the control. */
function variantsOf(kind: ExperimentKind, keys: [string, string]) {
  return keys.map((key, index) => {
    const variant = EXPERIMENT_CATALOG[kind].find((candidate) => candidate.key === key)
    if (!variant) throw new Error(`the ${kind} catalog has no "${key}"`)
    return { ...variant, isControl: index === 0 }
  })
}

/** A running experiment the review leaves alone, so a test sees only the step it is about. */
async function holdExperiments(ctx: MutationCtx, persona: Doc<'personas'>): Promise<Id<'experiments'>> {
  return startExperiment(ctx, persona, {
    name: 'Concept angle: Story vs Tutorial',
    hypothesis: 'Stories get more follows.',
    kind: 'concept',
    metric: 'follows',
    variants: variantsOf('concept', ['tutorial', 'story']),
    minExposures: 2000,
    minConfidence: 0.9,
    createdBy: 'operator',
    reason: 'Holding the experiment slot.',
  })
}

/** An experiment on the dimension decided by the operator `daysAgo` days ago: knowledge about it, and no rates to contradict. */
async function decidedByOperator(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  kind: ExperimentKind,
  keys: [string, string],
  daysAgo: number
) {
  const at = Date.now() - daysAgo * DAY
  const experimentId = await startExperiment(
    ctx,
    persona,
    {
      name: `${kind} test`,
      hypothesis: 'One of them is better.',
      kind,
      metric: 'follows',
      variants: variantsOf(kind, keys),
      minExposures: 2000,
      minConfidence: 0.9,
      createdBy: 'operator',
      reason: 'A test.',
    },
    at - DAY
  )
  const experiment = await ctx.db.get(experimentId)
  if (!experiment) throw new Error('experiment vanished')
  await applyExperimentDecision(ctx, experiment, { winnerKey: keys[1], lift: 0, confidence: 0 }, 'operator', 'it reads better', at)
}

describe('reviewStrategy', () => {
  it('moves pillar weight to the pillar that made more per measured video, and says why', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const inserted = await insertPersona(ctx)
      await ctx.db.patch(inserted._id, { pillars: ['n8n tutorials', 'Automation fails'] })
      const persona = await reload(ctx, inserted._id)
      await holdExperiments(ctx, persona)
      const now = Date.now()
      const paid = async (episode: Doc<'episodes'>, count: number) => {
        for (let index = 0; index < count; index += 1) {
          await ctx.db.insert('conversions', {
            personaId: persona._id,
            episodeId: episode._id,
            kind: 'paid',
            via: index % 2 === 0 ? 'utm' : 'code',
            distinctId: Math.random().toString(36),
            at: now - DAY,
            mock: true,
          })
        }
      }
      for (const daysAgo of [5, 7]) {
        await paid(
          await insertMeasuredVideo(ctx, persona, {
            publishedAt: now - daysAgo * DAY,
            views: 1000,
            clicks: 30,
            pillar: 'Automation fails',
          }),
          2
        )
        await paid(
          await insertMeasuredVideo(ctx, persona, { publishedAt: now - daysAgo * DAY, views: 1000, clicks: 10, pillar: 'n8n tutorials' }),
          1
        )
      }
      // Out of the 28 days: it would put "n8n tutorials" ahead if it counted.
      await paid(
        await insertMeasuredVideo(ctx, persona, { publishedAt: now - 40 * DAY, views: 1000, clicks: 10, pillar: 'n8n tutorials' }),
        10
      )

      const outcome = await reviewStrategy(ctx, persona, now)

      expect(outcome).toEqual({ changes: 1, goalNoteId: expect.any(String) })
      const after = await reload(ctx, persona._id)
      expect(after.strategy?.pillarWeights).toEqual([
        { pillar: 'n8n tutorials', weight: expect.closeTo(0.4) },
        { pillar: 'Automation fails', weight: expect.closeTo(0.6) },
      ])
      expect(after.strategy?.reviewedAt).toBe(now)
      const entry = (await journalOf(ctx, persona._id)).find((candidate) => candidate.kind === 'pillar_weights')
      expect(entry).toMatchObject({
        actor: 'analyst',
        text: '"Automation fails" gets 60% of the evergreen plan, up from 50%, and "n8n tutorials" 40%, down from 50%.',
        reason: 'Over the last 28 days "Automation fails" made 58 EUR per measured video over 2 videos, and "n8n tutorials" 29 EUR over 2.',
        createdAt: now,
      })
      expect(entry?.evidence.episodeIds).toHaveLength(4)
      expect(entry?.evidence.numbers).toEqual([
        { label: '"Automation fails" value per video (EUR)', value: 58 },
        { label: '"n8n tutorials" value per video (EUR)', value: 29 },
        { label: '"Automation fails" clicks per view (%)', value: 3 },
        { label: '"n8n tutorials" clicks per view (%)', value: 1 },
        { label: '"Automation fails" weight (%)', value: 60 },
        { label: '"n8n tutorials" weight (%)', value: 40 },
      ])
      const [learning, ...others] = await memoriesOf(ctx, persona._id, 'learning')
      expect(others).toEqual([])
      expect(learning).toMatchObject({
        actor: 'analyst',
        key: 'pillars',
        status: 'active',
        text:
          'Over the last 28 days "Automation fails" made 58 EUR per measured video over 2 videos, and "n8n tutorials" 29 EUR over 2. ' +
          'So "Automation fails" gets 60% of the evergreen plan and "n8n tutorials" 40%.',
        createdAt: now,
      })
      expect(learning?.evidence.episodeIds).toHaveLength(4)
      expect(await messagesOf(ctx, persona._id)).toEqual([
        'I reviewed my strategy: I gave "Automation fails" more of the plan and "n8n tutorials" less. The Strategy page has the reasons.',
      ])
    })
  })

  it('moves the publish hour when another hour has a median at least 20% higher', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      await holdExperiments(ctx, persona)
      const now = Date.now()
      const today = dayKey(now, TIMEZONE)
      const at = (daysAgo: number, hour: number) => instantAt(addDays(today, -daysAgo), hour, TIMEZONE)
      for (const [index, views] of [900, 1000, 1100].entries()) {
        await insertMeasuredVideo(ctx, persona, { publishedAt: at(3 + index, 16), views, clicks: 10 })
      }
      for (const [index, views] of [1400, 1500, 1600].entries()) {
        await insertMeasuredVideo(ctx, persona, { publishedAt: at(6 + index, 18), views, clicks: 10 })
      }
      // Not measured yet: it says nothing about its hour.
      await insertMeasuredVideo(ctx, persona, { publishedAt: at(1, 16), views: 50_000, clicks: 10, status: 'published' })
      for (const key of ['publish_hour:youtube', 'pillars']) {
        await ctx.db.insert('memories', {
          personaId: persona._id,
          kind: 'learning',
          text: `An older learning on ${key}.`,
          actor: 'analyst',
          evidence: { episodeIds: [], signalIds: [] },
          key,
          status: 'active',
          createdAt: now - 7 * DAY,
        })
      }

      const outcome = await reviewStrategy(ctx, persona, now)

      expect(outcome).toEqual({ changes: 1, goalNoteId: expect.any(String) })
      const after = await reload(ctx, persona._id)
      expect(after.formats.map((format) => [format.platform, format.publishHour])).toEqual([
        ['youtube', 18],
        ['x', persona.formats[1]?.publishHour],
      ])
      const entry = (await journalOf(ctx, persona._id)).find((candidate) => candidate.kind === 'publish_hour')
      expect(entry).toMatchObject({
        actor: 'analyst',
        text: 'YouTube videos go out at 18:00 now, not 16:00.',
        reason:
          'Over the last 56 days 3 YouTube videos published at 18:00 had a median of 1,500 views, against 1,000 for 3 at 16:00. ' +
          'Publications already scheduled keep their time.',
      })
      expect(entry?.evidence.episodeIds).toHaveLength(6)
      expect(entry?.evidence.numbers).toEqual([
        { label: 'Median views at 18:00', value: 1500 },
        { label: 'Median views at 16:00', value: 1000 },
        { label: 'Videos at 18:00', value: 3 },
        { label: 'Videos at 16:00', value: 3 },
      ])
      const learnings = await memoriesOf(ctx, persona._id, 'learning')
      const learning = learnings.find((candidate) => candidate.createdAt === now)
      expect(learning).toMatchObject({
        actor: 'analyst',
        key: 'publish_hour:youtube',
        status: 'active',
        text: 'On YouTube, videos published at 18:00 had a median of 1,500 views over the last 56 days, against 1,000 at 16:00, so YouTube videos go out at 18:00 now.',
      })
      expect(learning?.evidence.episodeIds).toHaveLength(6)
      // The older learning on the same subject stands down for it; one on another subject stays.
      expect(learnings.find((candidate) => candidate.key === 'publish_hour:youtube' && candidate._id !== learning?._id)).toMatchObject({
        status: 'superseded',
        supersededBy: learning?._id,
      })
      expect(learnings.find((candidate) => candidate.key === 'pillars')?.status).toBe('active')
      expect(await messagesOf(ctx, persona._id)).toEqual([
        'I reviewed my strategy: I moved YouTube to 18:00. The Strategy page has the reasons.',
      ])
    })
  })

  it('moves no publish hour while a publish time test runs, since that test is moving it', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      await startExperiment(ctx, persona, {
        name: 'Publish time: Three hours earlier vs Usual hour',
        hypothesis: 'Earlier finds more viewers.',
        kind: 'publish_time',
        metric: 'follows',
        variants: variantsOf('publish_time', ['usual', 'earlier']),
        minExposures: 2000,
        minConfidence: 0.9,
        createdBy: 'analyst',
        reason: 'Publish time was never tested.',
      })
      const now = Date.now()
      const today = dayKey(now, TIMEZONE)
      const at = (daysAgo: number, hour: number) => instantAt(addDays(today, -daysAgo), hour, TIMEZONE)
      // The same numbers that move YouTube to 18:00 when nothing tests the hour.
      for (const [index, views] of [900, 1000, 1100].entries()) {
        await insertMeasuredVideo(ctx, persona, { publishedAt: at(3 + index, 16), views, clicks: 10 })
      }
      for (const [index, views] of [1400, 1500, 1600].entries()) {
        await insertMeasuredVideo(ctx, persona, { publishedAt: at(6 + index, 18), views, clicks: 10 })
      }

      expect(await reviewStrategy(ctx, persona, now)).toEqual({ changes: 0, goalNoteId: expect.any(String) })
      expect((await reload(ctx, persona._id)).formats).toEqual(persona.formats)
      expect((await journalOf(ctx, persona._id)).filter((entry) => entry.kind === 'publish_hour')).toEqual([])
    })
  })

  it('never doubts a publish time as a default: its decision moved the hours instead', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const now = Date.now()
      const experimentId = await startExperiment(
        ctx,
        persona,
        {
          name: 'Publish time: Three hours earlier vs Usual hour',
          hypothesis: 'Earlier finds more viewers.',
          kind: 'publish_time',
          metric: 'clicks',
          variants: variantsOf('publish_time', ['usual', 'earlier']),
          minExposures: 2000,
          minConfidence: 0.9,
          createdBy: 'analyst',
          reason: 'Publish time was never tested.',
        },
        now - 60 * DAY
      )
      const experiment = await ctx.db.get(experimentId)
      if (!experiment) throw new Error('experiment vanished')
      await applyExperimentDecision(
        ctx,
        experiment,
        { winnerKey: 'earlier', lift: 1, confidence: 0.99, winnerRate: 0.02, runnerUpRate: 0.01, runnerUpKey: 'usual' },
        'analyst',
        'Earlier leads.',
        now - 30 * DAY
      )
      // A default as a publish time decision never writes one, with numbers since that would doubt any
      // other dimension's: the scan passes it over instead of re-testing hours the formats already moved.
      const decided = await reload(ctx, persona._id)
      await ctx.db.patch(persona._id, {
        strategy: {
          pillarWeights: [],
          defaults: [
            {
              kind: 'publish_time',
              key: 'earlier',
              label: 'Three hours earlier',
              description: 'Publish three hours before the platform’s usual hour.',
              hourOffset: -3,
              experimentId,
              since: now - 30 * DAY,
            },
          ],
        },
      })
      for (const daysAgo of [20, 10]) {
        await insertMeasuredVideo(ctx, persona, { publishedAt: now - daysAgo * DAY, views: 1500, clicks: 10 })
      }

      const outcome = await reviewStrategy(ctx, await reload(ctx, persona._id), now)

      if (!outcome.startedExperimentId) throw new Error('the review started no experiment')
      const started = await ctx.db.get(outcome.startedExperimentId)
      expect(started?.retestOf).toBeUndefined()
      expect(started?.kind).not.toBe('publish_time')
      expect(decided.formats[0]?.publishHour).toBe(13)
    })
  })

  it('writes nothing but the review time when nothing changes', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      await holdExperiments(ctx, persona)
      const before = await journalOf(ctx, persona._id)
      const now = Date.now()

      const outcome = await reviewStrategy(ctx, persona, now)

      expect(outcome).toEqual({ changes: 0, goalNoteId: expect.any(String) })
      expect((await reload(ctx, persona._id)).strategy).toEqual({ pillarWeights: [], defaults: [], reviewedAt: now })
      expect(await journalOf(ctx, persona._id)).toEqual(before)
      expect(await messagesOf(ctx, persona._id)).toEqual([])
      expect(await memoriesOf(ctx, persona._id, 'learning')).toEqual([])
    })
  })

  it('starts the experiment on the dimension it knows least about, aimed at follows while nothing closer has data', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const now = Date.now()

      const outcome = await reviewStrategy(ctx, persona, now)

      expect(outcome.changes).toBe(1)
      if (!outcome.startedExperimentId) throw new Error('the review started no experiment')
      const experiment = await ctx.db.get(outcome.startedExperimentId)
      expect(experiment).toMatchObject({
        name: 'Hook style: Question vs How to',
        hypothesis:
          '"Question" (open with the question the viewer has) gets more follows per view than "How to" (open by saying what the viewer will be able to do).',
        kind: 'hook',
        metric: 'follows',
        status: 'running',
        minExposures: 2000,
        minConfidence: 0.9,
        createdBy: 'analyst',
      })
      expect(experiment?.variants.map((variant) => [variant.key, variant.isControl])).toEqual([
        ['howto', true],
        ['question', false],
      ])
      expect(experiment?.retestOf).toBeUndefined()
      const [entry] = await journalOf(ctx, persona._id)
      expect(entry).toMatchObject({
        kind: 'experiment_started',
        actor: 'analyst',
        reason:
          'Hook style was never tested. It aims at follows per view: no step closer to paying customers had 10 successes in the last 28 days.',
      })
      expect(await messagesOf(ctx, persona._id)).toEqual([
        'I reviewed my strategy: I started "Hook style: Question vs How to". The Strategy page has the reasons.',
      ])
    })
  })

  it('aims the experiment at the step closest to paying customers with ten successes in the last 28 days', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const now = Date.now()
      const clicksPersona = await insertPersona(ctx, { name: 'Clicks', handle: 'clicks' })
      const episode = await insertMeasuredVideo(ctx, clicksPersona, { publishedAt: now - 5 * DAY, views: 1000, clicks: 10 })
      const [link] = await ctx.db
        .query('links')
        .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
        .collect()
      if (!link) throw new Error('the measured video has no link')
      for (let index = 0; index < 10; index += 1) {
        await ctx.db.insert('linkClicks', { linkId: link._id, personaId: clicksPersona._id, episodeId: episode._id, at: now - 2 * DAY })
        // Signups by code are not what a signups experiment counts.
        await ctx.db.insert('conversions', {
          personaId: clicksPersona._id,
          kind: 'signup',
          via: 'code',
          distinctId: `code-${index}`,
          at: now - 2 * DAY,
          mock: true,
        })
      }
      // Older than the window.
      for (let index = 0; index < 10; index += 1) {
        await ctx.db.insert('conversions', {
          personaId: clicksPersona._id,
          kind: 'paid',
          via: 'utm',
          distinctId: `old-${index}`,
          at: now - 40 * DAY,
          mock: true,
        })
      }
      const onClicks = await reviewStrategy(ctx, clicksPersona, now)
      if (!onClicks.startedExperimentId) throw new Error('the review started no experiment')
      expect(await ctx.db.get(onClicks.startedExperimentId)).toMatchObject({ metric: 'clicks', minExposures: 2000 })
      const [clicksEntry] = await journalOf(ctx, clicksPersona._id)
      expect(clicksEntry?.reason).toBe(
        'Hook style was never tested. It aims at clicks per view: 10 clicks in the last 28 days, the step closest to paying customers with at least 10.'
      )

      const signupsPersona = await insertPersona(ctx, { name: 'Signups', handle: 'signups' })
      for (let index = 0; index < 10; index += 1) {
        await ctx.db.insert('conversions', {
          personaId: signupsPersona._id,
          kind: 'signup',
          via: 'utm',
          distinctId: `utm-${index}`,
          at: now - 2 * DAY,
          mock: true,
        })
      }
      const onSignups = await reviewStrategy(ctx, signupsPersona, now)
      if (!onSignups.startedExperimentId) throw new Error('the review started no experiment')
      expect(await ctx.db.get(onSignups.startedExperimentId)).toMatchObject({ metric: 'signups', minExposures: 100 })
    })
  })

  it('tests the sponsor placement only once the persona carries a sponsor', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      // Every other dimension was decided lately, so the sponsor placement is what the persona knows least about.
      // The description format does not apply: the persona has no discount code, so its footer has one order.
      await decidedByOperator(ctx, persona, 'hook', ['howto', 'question'], 40)
      await decidedByOperator(ctx, persona, 'concept', ['tutorial', 'story'], 30)
      await decidedByOperator(ctx, persona, 'length', ['standard', 'shorter'], 20)
      await decidedByOperator(ctx, persona, 'cta', ['follow', 'comment'], 10)
      await decidedByOperator(ctx, persona, 'publish_time', ['usual', 'earlier'], 5)
      await decidedByOperator(ctx, persona, 'post_kind', ['rotate', 'text'], 4)
      await decidedByOperator(ctx, persona, 'reply_style', ['tip', 'question'], 3)
      await decidedByOperator(ctx, persona, 'reply_target', ['reach', 'peers'], 2)
      const review = async () => {
        const outcome = await reviewStrategy(ctx, await reload(ctx, persona._id), Date.now())
        if (!outcome.startedExperimentId) throw new Error('the review started no experiment')
        const experiment = await ctx.db.get(outcome.startedExperimentId)
        if (!experiment) throw new Error('experiment vanished')
        await stopExperiment(ctx, experiment._id, 'operator')
        return experiment
      }

      // Within the ramp: the dimension decided longest ago instead.
      expect((await review()).kind).toBe('hook')
      for (let index = 0; index < 10; index += 1) {
        await insertEpisode(ctx, persona, { status: 'published', plannedFor: addDays('2026-09-01', index) })
      }
      // Past the ramp with the dial at zero: still no sponsor.
      await ctx.db.patch(persona._id, { sponsorDial: 0 })
      expect((await review()).kind).not.toBe('sponsor')
      await ctx.db.patch(persona._id, { sponsorDial: 0.4 })
      const sponsor = await review()
      expect(sponsor).toMatchObject({ kind: 'sponsor', name: 'Sponsor placement: Early vs After the point' })
    })
  })

  it('gives a persona on X alone a post or reply experiment aimed at follows, and none once neither compares anything', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const xFormat = persona.formats.find((format) => format.platform === 'x')
      if (!xFormat?.cadence) throw new Error('the fixture persona lost its X cadence')
      await ctx.db.patch(persona._id, { formats: [xFormat] })

      const outcome = await reviewStrategy(ctx, await reload(ctx, persona._id), Date.now())
      if (!outcome.startedExperimentId) throw new Error('the review started no experiment')
      const experiment = await ctx.db.get(outcome.startedExperimentId)
      expect(experiment).toMatchObject({
        kind: 'post_kind',
        metric: 'follows',
        minExposures: 2000,
        name: 'Post kind: Text posts vs Rotate',
      })
      const [started] = (await journalOf(ctx, persona._id)).filter((entry) => entry.kind === 'experiment_started')
      expect(started?.reason).toBe(
        'Post kind was never tested. It aims at follows per view: posts on X carry no link, so follows are the step closest to paying customers they move.'
      )
      if (!experiment) throw new Error('experiment vanished')
      await stopExperiment(ctx, experiment._id, 'operator')

      // No image posts and no replies: nothing on X alone compares anything.
      await ctx.db.patch(persona._id, { formats: [{ ...xFormat, cadence: { ...xFormat.cadence, kinds: ['text'], repliesPerDay: 0 } }] })
      const quiet = await reviewStrategy(ctx, await reload(ctx, persona._id), Date.now())
      expect(quiet.startedExperimentId).toBeUndefined()
      const note = await ctx.db.get(quiet.goalNoteId)
      expect(note?.text).toMatch(/Next: nothing new to test this week\.$/)
    })
  })

  it('tests a default again against the variant it beat when later numbers no longer back it', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const now = Date.now()
      const experimentId = await startExperiment(
        ctx,
        persona,
        {
          name: 'Call to action: Comment vs Follow',
          hypothesis: 'Comment beats follow.',
          kind: 'cta',
          metric: 'clicks',
          variants: variantsOf('cta', ['follow', 'comment']),
          minExposures: 2000,
          minConfidence: 0.9,
          createdBy: 'analyst',
          reason: 'Call to action was never tested.',
        },
        now - 60 * DAY
      )
      const experiment = await ctx.db.get(experimentId)
      if (!experiment) throw new Error('experiment vanished')
      await applyExperimentDecision(
        ctx,
        experiment,
        { winnerKey: 'comment', lift: 1, confidence: 0.99, winnerRate: 0.02, runnerUpRate: 0.01, runnerUpKey: 'follow' },
        'analyst',
        'Comment leads.',
        now - 30 * DAY
      )
      // Since the decision the default ran 3,000 views at 0.67% clicks per view, under the 1.0% "Follow" had.
      for (const daysAgo of [20, 10]) {
        await insertMeasuredVideo(ctx, persona, { publishedAt: now - daysAgo * DAY, views: 1500, clicks: 10 })
      }

      const outcome = await reviewStrategy(ctx, await reload(ctx, persona._id), now)

      if (!outcome.startedExperimentId) throw new Error('the review started no experiment')
      const retest = await ctx.db.get(outcome.startedExperimentId)
      expect(retest).toMatchObject({ kind: 'cta', name: 'Call to action: Follow vs Comment', retestOf: experimentId, createdBy: 'analyst' })
      expect(retest?.variants.map((variant) => [variant.key, variant.isControl])).toEqual([
        ['comment', true],
        ['follow', false],
      ])
      const entry = (await journalOf(ctx, persona._id)).find(
        (candidate) => candidate.kind === 'experiment_started' && candidate.evidence.experimentId === retest?._id
      )
      expect(entry?.reason).toBe(
        '"Comment" became the call to action default by beating "Follow" 2.00% to 1.00% on clicks per view. ' +
          'Since then it got 0.67% over 3,000 views, no better than "Follow" had, so the two are tested again. ' +
          'It aims at follows per view: no step closer to paying customers had 10 successes in the last 28 days.'
      )
      const messages = await messagesOf(ctx, persona._id)
      expect(messages[messages.length - 1]).toBe(
        'I reviewed my strategy: I started testing "Comment" against "Follow" again, because later numbers no longer back it. The Strategy page has the reasons.'
      )
    })
  })

  it('doubts a default only once it has the metric’s minimum exposures, not the experiment’s own', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const now = Date.now()
      // The operator's quick experiment: 500 views per variant were enough to decide it.
      const experimentId = await startExperiment(
        ctx,
        persona,
        {
          name: 'Comment or follow',
          hypothesis: 'Comment beats follow.',
          kind: 'cta',
          metric: 'clicks',
          variants: variantsOf('cta', ['follow', 'comment']),
          minExposures: 500,
          minConfidence: 0.9,
          createdBy: 'operator',
          reason: 'Comment beats follow.',
        },
        now - 60 * DAY
      )
      const experiment = await ctx.db.get(experimentId)
      if (!experiment) throw new Error('experiment vanished')
      await applyExperimentDecision(
        ctx,
        experiment,
        { winnerKey: 'comment', lift: 1, confidence: 0.95, winnerRate: 0.02, runnerUpRate: 0.01, runnerUpKey: 'follow' },
        'analyst',
        'Comment leads.',
        now - 30 * DAY
      )
      // 1,000 views since at 0.7% clicks per view: past the experiment's 500, short of the 2,000 clicks per view needs.
      await insertMeasuredVideo(ctx, persona, { publishedAt: now - 20 * DAY, views: 1000, clicks: 7 })
      const first = await reviewStrategy(ctx, await reload(ctx, persona._id), now)
      if (!first.startedExperimentId) throw new Error('the review started no experiment')
      const fresh = await ctx.db.get(first.startedExperimentId)
      expect(fresh?.retestOf).toBeUndefined()
      expect(fresh?.kind).not.toBe('cta')
      await stopExperiment(ctx, first.startedExperimentId, 'operator')

      // Another 1,500 views at the same rate: 2,500 since, and the default is tested again.
      await insertMeasuredVideo(ctx, persona, { publishedAt: now - 10 * DAY, views: 1500, clicks: 10 })
      const second = await reviewStrategy(ctx, await reload(ctx, persona._id), now)
      if (!second.startedExperimentId) throw new Error('the review started no experiment')
      expect(await ctx.db.get(second.startedExperimentId)).toMatchObject({ kind: 'cta', retestOf: experimentId })
    })
  })
})

describe('goal notes', () => {
  it('leaves one every review, naming paid customers against the span before and what runs next, and retires the one before', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const experimentId = await holdExperiments(ctx, persona)
      const now = Date.now()
      const episode = await insertEpisode(ctx, persona, { status: 'measured', plannedFor: dayKey(now - 3 * DAY, TIMEZONE) })
      for (const [index, daysAgo] of [3, 10, 40].entries()) {
        await ctx.db.insert('conversions', {
          personaId: persona._id,
          episodeId: episode._id,
          kind: 'paid',
          via: 'utm',
          distinctId: `buyer-${index}`,
          at: now - daysAgo * DAY,
          mock: true,
        })
      }

      const first = await reviewStrategy(ctx, persona, now - DAY)
      const second = await reviewStrategy(ctx, await reload(ctx, persona._id), now)

      const notes = await memoriesOf(ctx, persona._id, 'goal_note')
      expect(notes.map((note) => [note._id, note.status])).toEqual([
        [first.goalNoteId, 'superseded'],
        [second.goalNoteId, 'active'],
      ])
      expect(notes[0]?.supersededBy).toBe(second.goalNoteId)
      expect(notes[1]).toMatchObject({
        actor: 'analyst',
        text: '2 paid customers in the last 28 days, worth 58 EUR, up from 1 (29 EUR) in the 28 days before. Next: testing "Concept angle: Story vs Tutorial".',
        evidence: { experimentId, episodeIds: [episode._id], signalIds: [] },
        createdAt: now,
      })
    })
  })

  it('says the trend in every direction and what comes next', () => {
    const standing = { windowDays: 28, valuePerPaid: 29, currency: 'EUR', testing: null }
    expect(goalNoteText({ ...standing, paid: 0, previousPaid: 0 })).toBe(
      'No paid customers yet in the last 28 days, nor in the 28 days before. Next: nothing new to test this week.'
    )
    expect(goalNoteText({ ...standing, paid: 0, previousPaid: 2 })).toBe(
      'No paid customers in the last 28 days, down from 2 (58 EUR) in the 28 days before. Next: nothing new to test this week.'
    )
    expect(goalNoteText({ ...standing, paid: 1, previousPaid: 1 })).toBe(
      '1 paid customer in the last 28 days, worth 29 EUR, the same as in the 28 days before. Next: nothing new to test this week.'
    )
    expect(goalNoteText({ ...standing, paid: 3, previousPaid: 0 })).toBe(
      '3 paid customers in the last 28 days, worth 87 EUR, up from none in the 28 days before. Next: nothing new to test this week.'
    )
    expect(goalNoteText({ ...standing, paid: 1, previousPaid: 4, testing: 'Hook style: Question vs How to' })).toBe(
      '1 paid customer in the last 28 days, worth 29 EUR, down from 4 (116 EUR) in the 28 days before. Next: testing "Hook style: Question vs How to".'
    )
  })
})
