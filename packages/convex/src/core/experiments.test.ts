import { EXPERIMENT_CATALOG, type ReplyOrigin, type XCadence } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { insertMeasuredVideo, insertPersona } from '../../test/fixtures'
import { setup } from '../../test/setup'
import {
  analystDecisionNote,
  applyExperimentDecision,
  startExperiment,
  stopExperiment,
  variantStatsFor,
  variantStatsSince,
  type StartExperimentInput,
} from './experiments'

const DAY = 24 * 60 * 60 * 1000
const [follow, comment, link] = EXPERIMENT_CATALOG.cta

function ctaExperiment(overrides: Partial<StartExperimentInput> = {}): StartExperimentInput {
  if (!follow || !comment) throw new Error('the cta catalog lost a variant')
  return {
    name: 'Call to action: Comment vs Follow',
    hypothesis: 'Comment beats follow.',
    kind: 'cta',
    metric: 'clicks',
    variants: [
      { ...follow, isControl: true },
      { ...comment, isControl: false },
    ],
    minExposures: 2000,
    minConfidence: 0.9,
    createdBy: 'analyst',
    reason: 'Call to action was never tested.',
    ...overrides,
  }
}

async function experimentOf(ctx: MutationCtx, experimentId: Id<'experiments'>): Promise<Doc<'experiments'>> {
  const experiment = await ctx.db.get(experimentId)
  if (!experiment) throw new Error('experiment vanished')
  return experiment
}

async function journalOf(ctx: MutationCtx, persona: Doc<'personas'>): Promise<Doc<'journal'>[]> {
  return ctx.db
    .query('journal')
    .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id))
    .collect()
}

describe('startExperiment', () => {
  it('starts the experiment with who set it up and journals why', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const experimentId = await startExperiment(ctx, persona, ctaExperiment())
      const experiment = await experimentOf(ctx, experimentId)
      expect(experiment).toMatchObject({ status: 'running', createdBy: 'analyst', kind: 'cta' })
      expect(experiment.retestOf).toBeUndefined()
      const [entry] = await journalOf(ctx, persona)
      expect(entry).toMatchObject({
        kind: 'experiment_started',
        actor: 'analyst',
        text: 'Started "Call to action: Comment vs Follow".',
        reason: 'Call to action was never tested.',
        evidence: { experimentId, episodeIds: [] },
      })
      expect(entry?.evidence.numbers).toEqual([
        { label: 'Views needed per variant', value: 2000 },
        { label: 'Confidence needed (%)', value: 90 },
      ])
    })
  })

  it('refuses a second running experiment, a single variant, duplicate keys and a length factor off the length dimension', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      if (!follow || !comment) throw new Error('the cta catalog lost a variant')
      await expect(startExperiment(ctx, persona, ctaExperiment({ variants: [{ ...follow, isControl: true }] }))).rejects.toThrow(
        'An experiment needs at least two variants.'
      )
      await expect(
        startExperiment(
          ctx,
          persona,
          ctaExperiment({
            variants: [
              { ...follow, isControl: true },
              { ...follow, isControl: false },
            ],
          })
        )
      ).rejects.toThrow('Variant keys must be unique.')
      await expect(
        startExperiment(
          ctx,
          persona,
          ctaExperiment({
            variants: [
              { ...follow, isControl: true },
              { ...comment, isControl: false, lengthFactor: 0.7 },
            ],
          })
        )
      ).rejects.toThrow('Only an episode length experiment scales length')
      await startExperiment(ctx, persona, ctaExperiment())
      await expect(startExperiment(ctx, persona, ctaExperiment({ name: 'Another' }))).rejects.toThrow(
        '"Call to action: Comment vs Follow" is still running; stop it first so episodes carry one variant.'
      )
    })
  })

  it('refuses a description format test without a discount code, a publish time test on X alone, and an hour offset elsewhere', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      await expect(startExperiment(ctx, persona, catalogExperiment('description_format', ['link', 'code']))).rejects.toThrow(
        'Ada Automates has no discount code in force, so a description format test would compare nothing.'
      )
      await expect(startExperiment(ctx, persona, catalogExperiment('cta', ['follow', 'comment'], { hourOffset: 3 }))).rejects.toThrow(
        'Only a publish time experiment moves the hour; "Comment" has an hour offset.'
      )

      const xOnly = await insertPersona(ctx, { name: 'Xavier', handle: 'xavier' })
      await ctx.db.patch(xOnly._id, { formats: xOnly.formats.filter((format) => format.platform === 'x') })
      const reloaded = await ctx.db.get(xOnly._id)
      if (!reloaded) throw new Error('persona vanished')
      await expect(startExperiment(ctx, reloaded, catalogExperiment('publish_time', ['usual', 'earlier']))).rejects.toThrow(
        'Xavier publishes only on X, which keeps its own hours and prints no footer, so a publish time test would compare nothing.'
      )

      await ctx.db.insert('discountCodes', {
        personaId: persona._id,
        code: 'ADA20',
        offer: '20% off',
        active: true,
        redemptions: 0,
        createdAt: Date.now(),
      })
      const unknown = catalogExperiment('description_format', ['link', 'code'])
      await expect(
        startExperiment(ctx, persona, {
          ...unknown,
          variants: unknown.variants.map((variant) => (variant.isControl ? variant : { ...variant, key: 'emoji', label: 'Emoji first' })),
        })
      ).rejects.toThrow('"Emoji first" is no description format; the footer puts either the link or the code first.')
      const experimentId = await startExperiment(ctx, persona, catalogExperiment('description_format', ['link', 'code']))
      expect((await experimentOf(ctx, experimentId)).kind).toBe('description_format')
    })
  })

  it('refuses a post or reply test that would compare nothing, a metric a post or reply cannot carry, and a key nothing acts on', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const withCadence = async (cadence: Partial<XCadence>) => {
        const formats = persona.formats.map((format) =>
          format.cadence ? { ...format, cadence: { ...format.cadence, ...cadence } } : format
        )
        await ctx.db.patch(persona._id, { formats })
        const reloaded = await ctx.db.get(persona._id)
        if (!reloaded) throw new Error('persona vanished')
        return reloaded
      }
      const silent = await withCadence({ repliesPerDay: 0, kinds: ['text', 'thread'] })
      await expect(startExperiment(ctx, silent, catalogExperiment('reply_style', ['tip', 'question']))).rejects.toThrow(
        'Ada Automates answers nobody on X, so a reply style test would compare nothing. Give it X and a reply budget above 0 first.'
      )
      await expect(startExperiment(ctx, silent, catalogExperiment('post_kind', ['rotate', 'image']))).rejects.toThrow(
        "Ada Automates's X cadence does not hold both text and image posts, so a post kind test would compare nothing."
      )

      const ready = await withCadence({ repliesPerDay: 5, kinds: ['text', 'image', 'thread'] })
      await expect(
        startExperiment(ctx, ready, { ...catalogExperiment('reply_style', ['tip', 'question']), metric: 'clicks' })
      ).rejects.toThrow('A reply style test is decided on views or follows: replies on X carry no link and no watch rate.')
      const target = catalogExperiment('reply_target', ['reach', 'peers'])
      await expect(
        startExperiment(ctx, ready, {
          ...target,
          variants: target.variants.map((variant) => (variant.isControl ? variant : { ...variant, key: 'famous', label: 'Famous' })),
        })
      ).rejects.toThrow('"Famous" is no reply target the listener knows; the keys are reach, peers.')
      const experimentId = await startExperiment(ctx, ready, catalogExperiment('post_kind', ['rotate', 'image']))
      expect((await experimentOf(ctx, experimentId)).kind).toBe('post_kind')
    })
  })
})

/** An experiment on two catalog variants of `kind`, the first the control; `challenger` overrides the second's fields. */
function catalogExperiment(
  kind: StartExperimentInput['kind'],
  keys: [string, string],
  challenger: { hourOffset?: number } = {}
): StartExperimentInput {
  const variants = keys.map((key, index) => {
    const variant = EXPERIMENT_CATALOG[kind].find((candidate) => candidate.key === key)
    if (!variant) throw new Error(`the ${kind} catalog has no "${key}"`)
    return index === 0 ? { ...variant, isControl: true } : { ...variant, ...challenger, isControl: false }
  })
  return {
    name: `${kind} test`,
    hypothesis: 'One of them is better.',
    kind,
    metric: 'follows',
    variants,
    minExposures: 2000,
    minConfidence: 0.9,
    createdBy: 'operator',
    reason: 'A test.',
  }
}

describe('a decided publish time', () => {
  it('moves the video hours, keeps X at its own, stores no default, and says the new hours', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const experimentId = await startExperiment(ctx, persona, catalogExperiment('publish_time', ['usual', 'earlier']))
      await applyExperimentDecision(
        ctx,
        await experimentOf(ctx, experimentId),
        { winnerKey: 'earlier', lift: 0, confidence: 0 },
        'operator',
        ''
      )
      const after = await ctx.db.get(persona._id)
      expect(after?.formats.map((format) => [format.platform, format.publishHour])).toEqual([
        ['youtube', 13],
        ['x', persona.formats[1]?.publishHour],
      ])
      expect(after?.strategy?.defaults ?? []).toEqual([])
      const decided = (await journalOf(ctx, persona)).find((entry) => entry.kind === 'experiment_decided')
      expect(decided?.text).toBe('"Three hours earlier" won. Video hours now: YouTube 13:00 (was 16:00).')
      const messages = await ctx.db
        .query('messages')
        .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
        .collect()
      expect(messages.map((message) => message.text)).toEqual([
        'Experiment "publish_time test" is decided: you picked "Three hours earlier". From now on I publish YouTube videos at 13:00.',
      ])
      const learnings = await ctx.db
        .query('memories')
        .withIndex('by_persona_kind_status', (q) => q.eq('personaId', persona._id).eq('kind', 'learning').eq('status', 'active'))
        .collect()
      expect(learnings).toHaveLength(1)
      expect(learnings[0]).toMatchObject({ dimension: 'publish_time', confidence: 1, evidence: { experimentId, signalIds: [] } })
    })
  })
})

describe('analystDecisionNote', () => {
  it('names the winner, its lead on the rate and a confidence that never reads 100%', () => {
    const experiment = ctaExperiment()
    expect(analystDecisionNote(experiment, { winnerKey: 'comment', lift: 0.5, confidence: 0.9996 })).toBe(
      '"Comment" leads on clicks per view by 50% at 99% confidence.'
    )
  })
})

describe('applyExperimentDecision', () => {
  it('makes the winner the default, writes the learning, supersedes the older one, journals and says it once', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      // What an earlier cta decision left: a default and a learning, and a hook learning that stays.
      const older = await ctx.db.insert('memories', {
        personaId: persona._id,
        kind: 'learning',
        text: 'Call to action: "Link" beat "Follow".',
        actor: 'analyst',
        dimension: 'cta',
        evidence: { episodeIds: [], signalIds: [] },
        confidence: 0.92,
        status: 'active',
        createdAt: Date.now() - 90 * DAY,
      })
      const hookLearning = await ctx.db.insert('memories', {
        personaId: persona._id,
        kind: 'learning',
        text: 'Hook style: "Question" beat "How to".',
        actor: 'analyst',
        dimension: 'hook',
        evidence: { episodeIds: [], signalIds: [] },
        confidence: 0.95,
        status: 'active',
        createdAt: Date.now() - 80 * DAY,
      })
      if (!link) throw new Error('the cta catalog lost a variant')
      await ctx.db.patch(persona._id, {
        strategy: {
          pillarWeights: [{ pillar: 'n8n tutorials', weight: 1 }],
          defaults: [{ kind: 'cta', key: link.key, label: link.label, description: link.description, since: Date.now() - 90 * DAY }],
        },
      })
      const experimentId = await startExperiment(ctx, persona, ctaExperiment())
      const now = Date.now()
      for (const [index, variantKey] of ['follow', 'comment', 'follow', 'comment'].entries()) {
        await insertMeasuredVideo(ctx, persona, {
          publishedAt: now - (10 - index) * DAY,
          views: 1500,
          clicks: variantKey === 'comment' ? 30 : 15,
          experimentId,
          variantKey,
        })
      }
      const experiment = await experimentOf(ctx, experimentId)
      await applyExperimentDecision(
        ctx,
        experiment,
        { winnerKey: 'comment', lift: 1, confidence: 0.9996, winnerRate: 0.02, runnerUpRate: 0.01, runnerUpKey: 'follow' },
        'analyst',
        '"Comment" leads on clicks by 100% at 99% confidence.',
        now
      )

      const decided = await experimentOf(ctx, experimentId)
      expect(decided.status).toBe('decided')
      expect(decided.decision).toEqual({
        winnerKey: 'comment',
        lift: 1,
        confidence: 0.9996,
        note: '"Comment" leads on clicks by 100% at 99% confidence.',
        decidedAt: now,
        byOperator: false,
        winnerRate: 0.02,
        runnerUpRate: 0.01,
        runnerUpKey: 'follow',
      })

      const after = await ctx.db.get(persona._id)
      expect(after?.strategy?.defaults).toEqual([
        { kind: 'cta', key: 'comment', label: 'Comment', description: comment?.description, experimentId, since: now },
      ])
      expect(after?.strategy?.pillarWeights).toEqual([{ pillar: 'n8n tutorials', weight: 1 }])

      const memories = await ctx.db
        .query('memories')
        .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id))
        .collect()
      const learning = memories.find((memory) => memory.status === 'active' && memory.dimension === 'cta')
      expect(learning?.text).toBe(
        'Call to action: "Comment" beat "Follow" on clicks per view, 2.00% against 1.00% over 6,000 views, 99% confidence.'
      )
      expect(learning?.confidence).toBe(0.9996)
      expect(learning?.evidence.experimentId).toBe(experimentId)
      expect(learning?.evidence.episodeIds).toHaveLength(4)
      expect(memories.find((memory) => memory._id === older)).toMatchObject({ status: 'superseded', supersededBy: learning?._id })
      expect(memories.find((memory) => memory._id === hookLearning)?.status).toBe('active')

      const decidedEntry = (await journalOf(ctx, persona)).find((entry) => entry.kind === 'experiment_decided')
      expect(decidedEntry).toMatchObject({ actor: 'analyst', text: '"Comment" is the default for call to action now.' })
      expect(decidedEntry?.evidence.episodeIds).toHaveLength(4)
      expect(decidedEntry?.evidence.numbers).toEqual([
        { label: '"Follow" clicks per view (%)', value: 1 },
        { label: '"Follow" views', value: 3000 },
        { label: '"Comment" clicks per view (%)', value: 2 },
        { label: '"Comment" views', value: 3000 },
        { label: 'Confidence (%)', value: 99.9 },
      ])

      const messages = await ctx.db
        .query('messages')
        .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
        .collect()
      expect(messages.map((message) => message.text)).toEqual([
        'Experiment "Call to action: Comment vs Follow" is decided: "Comment" leads on clicks by 100% at 99% confidence. From now on I end with a question for the comments.',
      ])
    })
  })

  it('records the operator’s own verdict with full confidence and their note', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const experimentId = await startExperiment(ctx, persona, ctaExperiment({ createdBy: 'operator' }))
      await applyExperimentDecision(
        ctx,
        await experimentOf(ctx, experimentId),
        { winnerKey: 'comment', lift: 0, confidence: 0 },
        'operator',
        'the comments are where our customers talk'
      )
      const decided = await experimentOf(ctx, experimentId)
      expect(decided.decision?.byOperator).toBe(true)
      expect(decided.decision?.winnerRate).toBeUndefined()
      const [learning] = await ctx.db
        .query('memories')
        .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'active'))
        .collect()
      expect(learning?.text).toBe(
        'Call to action: "Comment" over "Follow", chosen by the operator: the comments are where our customers talk.'
      )
      expect(learning?.confidence).toBe(1)
      const entry = (await journalOf(ctx, persona)).find((candidate) => candidate.kind === 'experiment_decided')
      expect(entry?.actor).toBe('operator')
      expect(entry?.evidence.numbers.map((number) => number.label)).not.toContain('Confidence (%)')
      const [message] = await ctx.db
        .query('messages')
        .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
        .collect()
      expect(message?.text).toBe(
        'Experiment "Call to action: Comment vs Follow" is decided: you picked "Comment". the comments are where our customers talk. From now on I end with a question for the comments.'
      )
    })
  })

  it('lands once: a second decision on a decided experiment is refused and writes nothing', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const experimentId = await startExperiment(ctx, persona, ctaExperiment())
      // The daily evaluation decides while the operator's override form is still open.
      const running = await experimentOf(ctx, experimentId)
      await applyExperimentDecision(
        ctx,
        running,
        { winnerKey: 'comment', lift: 1, confidence: 0.95, winnerRate: 0.02, runnerUpRate: 0.01, runnerUpKey: 'follow' },
        'analyst',
        'Comment leads.'
      )
      const decided = await experimentOf(ctx, experimentId)
      await expect(
        applyExperimentDecision(ctx, decided, { winnerKey: 'follow', lift: 0, confidence: 0 }, 'operator', 'I like it better')
      ).rejects.toThrow('"Call to action: Comment vs Follow" is already decided.')
      expect((await experimentOf(ctx, experimentId)).decision).toMatchObject({ winnerKey: 'comment', winnerRate: 0.02, runnerUpRate: 0.01 })
      const learnings = await ctx.db
        .query('memories')
        .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id))
        .collect()
      expect(learnings).toHaveLength(1)
      const decidedEntries = (await journalOf(ctx, persona)).filter((entry) => entry.kind === 'experiment_decided')
      expect(decidedEntries).toHaveLength(1)
      const messages = await ctx.db
        .query('messages')
        .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
        .collect()
      expect(messages).toHaveLength(1)
    })
  })

  it('takes the rates of a decision all together or not at all', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const experimentId = await startExperiment(ctx, persona, ctaExperiment())
      const experiment = await experimentOf(ctx, experimentId)
      await expect(
        applyExperimentDecision(
          ctx,
          experiment,
          { winnerKey: 'comment', lift: 1, confidence: 0.95, winnerRate: 0.02, runnerUpRate: 0.01 },
          'analyst',
          ''
        )
      ).rejects.toThrow("needs the winner's rate, the runner-up's rate and its key together")
      await expect(
        applyExperimentDecision(
          ctx,
          experiment,
          { winnerKey: 'comment', lift: 1, confidence: 0.95, winnerRate: 0.02, runnerUpRate: 0.01, runnerUpKey: 'comment' },
          'analyst',
          ''
        )
      ).rejects.toThrow('names its winner "comment" as the runner-up')
      expect((await experimentOf(ctx, experimentId)).status).toBe('running')
    })
  })

  it('refuses a stopped experiment and a winner it does not have', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const experimentId = await startExperiment(ctx, persona, ctaExperiment())
      await expect(
        applyExperimentDecision(ctx, await experimentOf(ctx, experimentId), { winnerKey: 'link', lift: 0, confidence: 0 }, 'operator', '')
      ).rejects.toThrow('There is no variant "link".')
      await stopExperiment(ctx, experimentId, 'operator')
      await expect(
        applyExperimentDecision(
          ctx,
          await experimentOf(ctx, experimentId),
          { winnerKey: 'comment', lift: 0, confidence: 0 },
          'operator',
          ''
        )
      ).rejects.toThrow('"Call to action: Comment vs Follow" was stopped, so it cannot be decided.')
    })
  })
})

describe('stopExperiment', () => {
  it('stops a running experiment, journals it, and refuses one that is not running', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const experimentId = await startExperiment(ctx, persona, ctaExperiment({ createdBy: 'operator' }))
      await stopExperiment(ctx, experimentId, 'operator')
      expect((await experimentOf(ctx, experimentId)).status).toBe('stopped')
      const entry = (await journalOf(ctx, persona)).find((candidate) => candidate.kind === 'experiment_stopped')
      expect(entry).toMatchObject({ actor: 'operator', text: 'Stopped "Call to action: Comment vs Follow" before it was decided.' })
      await expect(stopExperiment(ctx, experimentId, 'operator')).rejects.toThrow('"Call to action: Comment vs Follow" is not running.')
    })
  })
})

describe('variantStatsFor', () => {
  it('counts signups per click from link conversions only', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const experimentId = await startExperiment(ctx, persona, ctaExperiment({ metric: 'signups', minExposures: 100 }))
      const now = Date.now()
      const episode = await insertMeasuredVideo(ctx, persona, {
        publishedAt: now - 5 * DAY,
        views: 1000,
        clicks: 40,
        experimentId,
        variantKey: 'comment',
      })
      for (const via of ['utm', 'utm', 'code'] as const) {
        await ctx.db.insert('conversions', {
          personaId: persona._id,
          episodeId: episode._id,
          kind: 'signup',
          via,
          distinctId: Math.random().toString(36),
          at: now - DAY,
          mock: true,
        })
      }
      const stats = await variantStatsFor(ctx, await experimentOf(ctx, experimentId))
      expect(stats).toEqual([
        { key: 'follow', episodes: 0, exposures: 0, successes: 0 },
        { key: 'comment', episodes: 1, exposures: 40, successes: 2 },
      ])
    })
  })
})

/** A reply X took and the analyst read, heard at `heardAt`. */
async function insertSentReply(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  fields: {
    heardAt: number
    impressions: number
    follows: number
    origin?: ReplyOrigin
    experimentId?: Id<'experiments'>
    variantKey?: string
  }
): Promise<Id<'replies'>> {
  const externalId = Math.random().toString(36).slice(2)
  return ctx.db.insert('replies', {
    personaId: persona._id,
    origin: fields.origin ?? 'search',
    inReplyTo: externalId,
    target: {
      text: 'A post',
      url: `https://x.com/dana/status/${externalId}`,
      postedAt: fields.heardAt,
      author: { handle: 'dana', name: 'Dana', followers: 3_000 },
    },
    ...(fields.experimentId === undefined ? {} : { experimentId: fields.experimentId, variantKey: fields.variantKey }),
    status: 'sent',
    text: 'A reply.',
    operatorAsked: false,
    heardAt: fields.heardAt,
    writtenAt: fields.heardAt,
    dispatchedAt: fields.heardAt,
    sentAt: fields.heardAt,
    externalId: `x-${externalId}`,
    url: `https://x.com/ada/status/x-${externalId}`,
    counts: { impressions: fields.impressions, likes: 0, replies: 0, profileVisits: 0, follows: fields.follows },
    measuredAt: fields.heardAt,
    mock: true,
  })
}

describe('a reply experiment', () => {
  it('counts follows per impression over its sent and measured replies', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const experimentId = await startExperiment(ctx, persona, catalogExperiment('reply_style', ['tip', 'question']))
      const now = Date.now()
      await insertSentReply(ctx, persona, { heardAt: now - DAY, impressions: 1000, follows: 4, experimentId, variantKey: 'tip' })
      await insertSentReply(ctx, persona, { heardAt: now - DAY, impressions: 500, follows: 6, experimentId, variantKey: 'question' })
      await insertSentReply(ctx, persona, { heardAt: now - DAY, impressions: 700, follows: 1, experimentId, variantKey: 'question' })
      // In no experiment: not counted.
      await insertSentReply(ctx, persona, { heardAt: now - DAY, impressions: 9000, follows: 90 })
      expect(await variantStatsFor(ctx, await experimentOf(ctx, experimentId))).toEqual([
        { key: 'tip', episodes: 1, exposures: 1000, successes: 4 },
        { key: 'question', episodes: 2, exposures: 1200, successes: 7 },
      ])
    })
  })

  it('measures a reply default since its decision by each reply’s own variant or the default, and a target on found posts only', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const since = Date.now() - 20 * DAY
      const at = (days: number) => Date.now() - days * DAY
      const styleId = await startExperiment(ctx, persona, catalogExperiment('reply_style', ['tip', 'question']))
      await stopExperiment(ctx, styleId, 'operator')
      const [, peers] = EXPERIMENT_CATALOG.reply_target
      const [, question] = EXPERIMENT_CATALOG.reply_style
      if (!peers || !question) throw new Error('the reply catalogs lost a variant')
      await ctx.db.patch(persona._id, {
        strategy: {
          pillarWeights: [],
          defaults: [
            { kind: 'reply_style', key: question.key, label: question.label, description: question.description, since },
            { kind: 'reply_target', key: peers.key, label: peers.label, description: peers.description, since },
          ],
        },
      })
      const reader = await ctx.db.get(persona._id)
      if (!reader) throw new Error('persona vanished')
      await insertSentReply(ctx, reader, { heardAt: at(10), impressions: 1000, follows: 5 })
      await insertSentReply(ctx, reader, { heardAt: at(9), impressions: 1000, follows: 5, origin: 'mention' })
      await insertSentReply(ctx, reader, { heardAt: at(8), impressions: 1000, follows: 5, experimentId: styleId, variantKey: 'question' })
      // Not counted: heard before the default, or its own variant is the tip.
      await insertSentReply(ctx, reader, { heardAt: at(30), impressions: 1000, follows: 5 })
      await insertSentReply(ctx, reader, { heardAt: at(7), impressions: 1000, follows: 5, experimentId: styleId, variantKey: 'tip' })
      expect(await variantStatsSince(ctx, reader, 'reply_style', 'question', since, 'follows')).toEqual({
        key: 'question',
        episodes: 3,
        exposures: 3000,
        successes: 15,
        episodeIds: [],
      })
      // A mention has no target to pick, so the peers default counts the found posts only.
      expect(await variantStatsSince(ctx, reader, 'reply_target', 'peers', since, 'follows')).toMatchObject({
        episodes: 3,
        exposures: 3000,
      })
    })
  })
})

describe('variantStatsSince', () => {
  it('counts the videos published since that do the variant, by their own variant or by the default', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      if (!comment) throw new Error('the cta catalog lost a variant')
      const since = Date.now() - 20 * DAY
      await ctx.db.patch(persona._id, {
        strategy: {
          pillarWeights: [],
          defaults: [{ kind: 'cta', key: 'comment', label: comment.label, description: comment.description, since }],
        },
      })
      const reader = await ctx.db.get(persona._id)
      if (!reader) throw new Error('persona vanished')
      // A hook experiment: its videos do the cta default.
      const hookId = await startExperiment(ctx, reader, {
        ...ctaExperiment(),
        name: 'Hook test',
        kind: 'hook',
        variants: EXPERIMENT_CATALOG.hook.slice(0, 2).map((variant, index) => ({ ...variant, isControl: index === 0 })),
      })
      await stopExperiment(ctx, hookId, 'operator')
      // A cta experiment: its videos do their own variant.
      const ctaId = await startExperiment(ctx, reader, ctaExperiment())
      const at = (days: number) => Date.now() - days * DAY
      await insertMeasuredVideo(ctx, reader, { publishedAt: at(10), views: 1000, clicks: 10 })
      await insertMeasuredVideo(ctx, reader, { publishedAt: at(9), views: 1000, clicks: 10, experimentId: hookId, variantKey: 'question' })
      await insertMeasuredVideo(ctx, reader, { publishedAt: at(8), views: 1000, clicks: 10, experimentId: ctaId, variantKey: 'comment' })
      // Not counted: before the default, its own variant is follow, or not out yet.
      await insertMeasuredVideo(ctx, reader, { publishedAt: at(30), views: 1000, clicks: 10 })
      await insertMeasuredVideo(ctx, reader, { publishedAt: at(7), views: 1000, clicks: 10, experimentId: ctaId, variantKey: 'follow' })
      const stats = await variantStatsSince(ctx, reader, 'cta', 'comment', since, 'clicks')
      expect(stats).toMatchObject({ key: 'comment', episodes: 3, exposures: 3000, successes: 30 })
      expect(stats.episodeIds).toHaveLength(3)
    })
  })

  it('counts only sponsored videos toward a sponsor default, even the control', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const end = EXPERIMENT_CATALOG.sponsor[0]
      if (!end) throw new Error('the sponsor catalog lost a variant')
      const since = Date.now() - 20 * DAY
      await ctx.db.patch(persona._id, {
        strategy: {
          pillarWeights: [],
          defaults: [{ kind: 'sponsor', key: end.key, label: end.label, description: end.description, since }],
        },
      })
      const reader = await ctx.db.get(persona._id)
      if (!reader) throw new Error('persona vanished')
      const at = (days: number) => Date.now() - days * DAY
      // Two unsponsored videos place no sponsor, so they say nothing about "After the point".
      await insertMeasuredVideo(ctx, reader, { publishedAt: at(10), views: 5000, clicks: 5 })
      await insertMeasuredVideo(ctx, reader, { publishedAt: at(9), views: 5000, clicks: 5 })
      const sponsored = await insertMeasuredVideo(ctx, reader, { publishedAt: at(8), views: 1000, clicks: 20, sponsorSegment: 'mention' })
      const stats = await variantStatsSince(ctx, reader, 'sponsor', 'end', since, 'clicks')
      expect(stats).toMatchObject({ key: 'end', episodes: 1, exposures: 1000, successes: 20 })
      expect(stats.episodeIds).toEqual([sponsored._id])
    })
  })
})
