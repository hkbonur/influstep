import { v } from 'convex/values'
import {
  MEASUREMENT_WINDOW_MS,
  SIGNAL_SOURCES,
  decideExperiment,
  METRIC_DENOMINATOR,
  type SignalSource,
  type VariantStats,
} from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { internalAction, internalMutation, internalQuery, type QueryCtx } from '../_generated/server'
import { addDays, dayKey } from '../core/dates'
import { approveEpisode, createIdea, shotsFromDraft } from '../core/episodes'
import { planWeek as planWeekRule } from '../core/planner'
import { latestPerPublication } from '../core/report'
import { providersMode } from '../lib/env'
import { analyticsProvider } from '../providers/analytics'
import { platformProvider } from '../providers/comments'
import { llmProvider } from '../providers/llm'
import { signalSourceHasRealAdapter, signalsProvider } from '../providers/signals'
import { conversionKindValidator, platformValidator, signalSourceValidator } from '../lib/validators'
import { applyEvent, type EpisodeContext } from './data'

/**
 * The five agent roles as actions. Each reads through internal queries, calls
 * a provider, and writes through internal mutations. A thrown error fails the
 * job (and the episode, when there is one) in dispatch.ts.
 */

// ---------------------------------------------------------------------------
// Researcher
// ---------------------------------------------------------------------------

export const pollSignals = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, args): Promise<{ found: number; skipped: SignalSource[] }> => {
    const personaId = args.personaId as Id<'personas'>
    const { persona } = await ctx.runQuery(internal.internal.data.getPersona, { personaId })
    const terms = [...persona.pillars, persona.niche]
    const since = Date.now() - 7 * 24 * 3_600_000
    const skipped: SignalSource[] = []
    let found = 0
    for (const source of SIGNAL_SOURCES) {
      if (source === 'comments') continue // the publisher reads comments from the persona's own publications
      if (providersMode() === 'real' && !signalSourceHasRealAdapter(source)) {
        skipped.push(source)
        continue
      }
      const signals = await signalsProvider(source).find({ terms, since, limit: 5 })
      found += await ctx.runMutation(internal.internal.agents.storeSignals, { personaId, signals, mock: providersMode() === 'mock' })
    }
    return { found, skipped }
  },
})

export const storeSignals = internalMutation({
  args: {
    personaId: v.id('personas'),
    mock: v.boolean(),
    signals: v.array(
      v.object({
        source: signalSourceValidator,
        externalId: v.string(),
        title: v.string(),
        url: v.string(),
        summary: v.string(),
        score: v.number(),
        topics: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<number> => {
    let inserted = 0
    for (const signal of args.signals) {
      const existing = await ctx.db
        .query('signals')
        .withIndex('by_persona_external', (q) =>
          q.eq('personaId', args.personaId).eq('source', signal.source).eq('externalId', signal.externalId)
        )
        .first()
      if (existing) {
        await ctx.db.patch(existing._id, { score: signal.score, summary: signal.summary })
        continue
      }
      await ctx.db.insert('signals', { ...signal, personaId: args.personaId, status: 'new', foundAt: Date.now(), mock: args.mock })
      inserted += 1
    }
    return inserted
  },
})

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export const planWeek = internalAction({
  args: { personaId: v.string(), weekStart: v.string() },
  handler: async (ctx, args): Promise<{ planned: number }> => {
    return ctx.runMutation(internal.internal.agents.planWeekMutation, {
      personaId: args.personaId as Id<'personas'>,
      weekStart: args.weekStart,
    })
  },
})

export const planWeekMutation = internalMutation({
  args: { personaId: v.id('personas'), weekStart: v.string() },
  handler: async (ctx, args): Promise<{ planned: number }> => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    if (persona.paused) return { planned: 0 }
    const all = await ctx.db
      .query('episodes')
      .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
      .collect()
    const live = all.filter((episode) => episode.status !== 'killed')
    // Days already holding an episode, plus days already gone: the planner never schedules into the past.
    const today = dayKey(Date.now(), persona.timezone)
    const takenDays = [
      ...live.filter((episode) => episode.plannedFor >= args.weekStart).map((episode) => episode.plannedFor),
      ...Array.from({ length: 7 }, (_, offset) => addDays(args.weekStart, offset)).filter((day) => day < today),
    ]
    const signals = await ctx.db
      .query('signals')
      .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'new'))
      .collect()
    const experiment = await ctx.db
      .query('experiments')
      .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'running'))
      .first()
    const assigned: Record<string, number> = {}
    if (experiment) {
      for (const episode of live)
        if (episode.experimentId === experiment._id && episode.variantKey)
          assigned[episode.variantKey] = (assigned[episode.variantKey] ?? 0) + 1
    }
    const plan = planWeekRule({
      weekStart: args.weekStart,
      persona: {
        pillars: persona.pillars,
        sponsorDial: persona.sponsorDial,
        sponsorRampEpisodes: persona.sponsorRampEpisodes,
        episodesPerWeek: persona.episodesPerWeek,
        episodeCount: live.length,
      },
      signals: signals.map((signal) => ({ id: signal._id, title: signal.title, score: signal.score, topics: signal.topics })),
      experiment: experiment ? { id: experiment._id, variantKeys: experiment.variants.map((variant) => variant.key), assigned } : undefined,
      takenDays,
    })
    for (const planned of plan) {
      await createIdea(ctx, persona, {
        personaId: persona._id,
        plannedFor: planned.plannedFor,
        concept: planned.concept,
        pillar: planned.pillar,
        sponsorSegment: planned.sponsorSegment,
        signalIds: planned.signalId ? [planned.signalId as Id<'signals'>] : [],
        experimentId: planned.experimentId ? (planned.experimentId as Id<'experiments'>) : undefined,
        variantKey: planned.variantKey,
      })
    }
    return { planned: plan.length }
  },
})

export const writeScript = internalAction({
  args: { episodeId: v.string() },
  handler: async (ctx, args): Promise<{ title: string }> => {
    const episodeId = args.episodeId as Id<'episodes'>
    const context: EpisodeContext = await ctx.runQuery(internal.internal.data.getEpisodeContext, { episodeId })
    const { episode, persona, workspace, directives, signals, experiment } = context
    const variant = experiment?.variants.find((candidate) => candidate.key === episode.variantKey)
    const draft = await llmProvider().writeScript({
      persona: {
        name: persona.name,
        handle: persona.handle,
        niche: persona.niche,
        tone: persona.tone,
        bible: persona.bible,
        pillars: persona.pillars,
      },
      concept: episode.concept,
      pillar: episode.pillar ?? persona.pillars[0] ?? '',
      sponsorSegment: episode.sponsorSegment,
      sponsorName: workspace.sponsorName,
      variant: variant ? { key: variant.key, description: variant.description } : undefined,
      directives: directives.map((directive) => directive.text),
      signals: signals.map((signal) => ({ title: signal.title, summary: signal.summary, url: signal.url })),
      platforms: persona.platforms,
    })
    await ctx.runMutation(internal.internal.agents.storeScript, {
      episodeId,
      title: draft.title,
      hook: draft.hook,
      script: draft.script,
      shots: shotsFromDraft(draft, workspace.sponsorName),
      autoApprove: persona.autoApprove,
    })
    return { title: draft.title }
  },
})

export const storeScript = internalMutation({
  args: {
    episodeId: v.id('episodes'),
    title: v.string(),
    hook: v.string(),
    script: v.object({ hook: v.string(), body: v.string(), sponsor: v.string(), cta: v.string() }),
    shots: v.any(),
    autoApprove: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.episodeId, {
      title: args.title,
      hook: args.hook,
      script: args.script,
      shots: args.shots,
      updatedAt: Date.now(),
    })
    await applyEvent(ctx, args.episodeId, { type: 'script_written' })
    if (args.autoApprove) await approveEpisode(ctx, args.episodeId)
  },
})

// ---------------------------------------------------------------------------
// Publisher: comments back into signals
// ---------------------------------------------------------------------------

export const pollComments = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, args): Promise<{ found: number }> => {
    const personaId = args.personaId as Id<'personas'>
    const publications = await ctx.runQuery(internal.internal.agents.livePublications, { personaId })
    let found = 0
    for (const publication of publications) {
      if (!publication.externalId) continue
      const comments = await platformProvider(publication.platform).comments(publication.externalId)
      found += await ctx.runMutation(internal.internal.agents.storeSignals, {
        personaId,
        mock: providersMode() === 'mock',
        signals: comments.map((comment) => ({
          source: 'comments' as const,
          externalId: comment.externalId,
          title: comment.text.slice(0, 120),
          url: publication.url ?? '',
          summary: `${comment.likes} likes under "${publication.title}" on ${publication.platform}`,
          score: comment.likes * 5 + 5,
          topics: [publication.platform],
        })),
      })
    }
    return { found }
  },
})

export const livePublications = internalQuery({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<Doc<'publications'>[]> => {
    const publications = await ctx.db
      .query('publications')
      .withIndex('by_persona', (q) => q.eq('personaId', args.personaId))
      .collect()
    return publications.filter((publication) => publication.status === 'live')
  },
})

// ---------------------------------------------------------------------------
// Analyst
// ---------------------------------------------------------------------------

export const pullMetrics = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, args): Promise<{ snapshots: number; conversions: number; measured: number }> => {
    const personaId = args.personaId as Id<'personas'>
    const { persona } = await ctx.runQuery(internal.internal.data.getPersona, { personaId })
    const publications = await ctx.runQuery(internal.internal.agents.livePublications, { personaId })
    let snapshots = 0
    for (const publication of publications) {
      if (!publication.externalId || !publication.publishedAt) continue
      const counts = await platformProvider(publication.platform).counts({
        externalId: publication.externalId,
        publishedAt: publication.publishedAt,
      })
      const clicks = await ctx.runQuery(internal.internal.agents.clicksForLink, { linkId: publication.linkId })
      await ctx.runMutation(internal.internal.agents.storeSnapshot, {
        personaId,
        episodeId: publication.episodeId,
        publicationId: publication._id,
        platform: publication.platform,
        counts: { ...counts, clicks, signups: 0, paid: 0 },
        mock: providersMode() === 'mock',
      })
      snapshots += 1
    }
    const since = Date.now() - 30 * 24 * 3_600_000
    const clicksSince = await ctx.runQuery(internal.internal.agents.clicksForPersona, { personaId, since })
    const found = await analyticsProvider().conversions({ personaHandle: persona.handle, since, clicksSince })
    const conversions = await ctx.runMutation(internal.internal.agents.storeConversions, {
      personaId,
      conversions: found,
      mock: providersMode() === 'mock',
    })
    const measured = await ctx.runMutation(internal.internal.agents.measureEpisodes, { personaId })
    await ctx.runAction(internal.internal.agents.evaluateExperiments, { personaId })
    return { snapshots, conversions, measured }
  },
})

export const clicksForLink = internalQuery({
  args: { linkId: v.id('links') },
  handler: async (ctx, args): Promise<number> => (await ctx.db.get(args.linkId))?.clicks ?? 0,
})

export const clicksForPersona = internalQuery({
  args: { personaId: v.id('personas'), since: v.number() },
  handler: async (ctx, args): Promise<number> => {
    const clicks = await ctx.db
      .query('linkClicks')
      .withIndex('by_persona_time', (q) => q.eq('personaId', args.personaId).gte('at', args.since))
      .collect()
    return clicks.length
  },
})

export const storeSnapshot = internalMutation({
  args: {
    personaId: v.id('personas'),
    episodeId: v.id('episodes'),
    publicationId: v.id('publications'),
    platform: platformValidator,
    counts: v.object({
      views: v.number(),
      watchRate: v.number(),
      follows: v.number(),
      likes: v.number(),
      comments: v.number(),
      clicks: v.number(),
      signups: v.number(),
      paid: v.number(),
    }),
    mock: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('metricSnapshots', {
      personaId: args.personaId,
      episodeId: args.episodeId,
      publicationId: args.publicationId,
      platform: args.platform,
      takenAt: Date.now(),
      counts: args.counts,
      mock: args.mock,
    })
  },
})

export const storeConversions = internalMutation({
  args: {
    personaId: v.id('personas'),
    mock: v.boolean(),
    conversions: v.array(
      v.object({
        kind: conversionKindValidator,
        distinctId: v.string(),
        at: v.number(),
        utm: v.object({
          source: v.string(),
          medium: v.optional(v.string()),
          campaign: v.optional(v.string()),
          content: v.optional(v.string()),
        }),
      })
    ),
  },
  handler: async (ctx, args): Promise<number> => {
    let inserted = 0
    const episodes = await ctx.db
      .query('episodes')
      .withIndex('by_persona', (q) => q.eq('personaId', args.personaId))
      .collect()
    for (const conversion of args.conversions) {
      const kind = conversion.kind
      const existing = await ctx.db
        .query('conversions')
        .withIndex('by_distinct', (q) => q.eq('distinctId', conversion.distinctId).eq('kind', kind))
        .first()
      if (existing) continue
      const episode = conversion.utm.campaign ? episodes.find((candidate) => candidate.slug === conversion.utm.campaign) : undefined
      await ctx.db.insert('conversions', {
        personaId: args.personaId,
        episodeId: episode?._id,
        variantKey: conversion.utm.content ?? episode?.variantKey,
        kind,
        distinctId: conversion.distinctId,
        at: conversion.at,
        mock: args.mock,
      })
      inserted += 1
    }
    return inserted
  },
})

/** Published episodes past their measurement window become measured. */
export const measureEpisodes = internalMutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<number> => {
    const episodes = await ctx.db
      .query('episodes')
      .withIndex('by_persona', (q) => q.eq('personaId', args.personaId))
      .collect()
    let measured = 0
    for (const episode of episodes) {
      if (episode.status !== 'published' || !episode.publishedAt) continue
      if (episode.publishedAt + MEASUREMENT_WINDOW_MS > Date.now()) continue
      await ctx.db.patch(episode._id, { measuredAt: Date.now() })
      await applyEvent(ctx, episode._id, { type: 'measured' })
      measured += 1
    }
    return measured
  },
})

export const evaluateExperiments = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, args): Promise<{ decided: number }> => {
    return ctx.runMutation(internal.internal.agents.evaluateExperimentsMutation, { personaId: args.personaId as Id<'personas'> })
  },
})

export const evaluateExperimentsMutation = internalMutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<{ decided: number }> => {
    const experiments = await ctx.db
      .query('experiments')
      .withIndex('by_persona_status', (q) => q.eq('personaId', args.personaId).eq('status', 'running'))
      .collect()
    let decided = 0
    for (const experiment of experiments) {
      const stats = await variantStatsFor(ctx, experiment)
      const decision = decideExperiment(stats, { minExposures: experiment.minExposures, minConfidence: experiment.minConfidence })
      if (!decision) continue
      const winner = experiment.variants.find((variant) => variant.key === decision.winnerKey)
      const note = `"${winner?.label ?? decision.winnerKey}" leads on ${experiment.metric} by ${Math.round(decision.lift * 100)}% at ${Math.round(decision.confidence * 100)}% confidence.`
      await ctx.db.patch(experiment._id, { status: 'decided', decision: { ...decision, note, decidedAt: Date.now(), byOperator: false } })
      await ctx.db.insert('messages', {
        personaId: args.personaId,
        author: 'persona',
        text: `Experiment "${experiment.name}" is decided: ${note} The next scripts follow the winner.`,
        createdAt: Date.now(),
      })
      decided += 1
    }
    return { decided }
  },
})

/** Exposures and successes per variant, from measured episodes, by the experiment's metric. */
export async function variantStatsFor(ctx: { db: QueryCtx['db'] }, experiment: Doc<'experiments'>): Promise<VariantStats[]> {
  const episodes = await ctx.db
    .query('episodes')
    .withIndex('by_persona', (q) => q.eq('personaId', experiment.personaId))
    .collect()
  const stats = new Map<string, VariantStats>(
    experiment.variants.map((variant) => [variant.key, { key: variant.key, episodes: 0, exposures: 0, successes: 0 }])
  )
  const denominator = METRIC_DENOMINATOR[experiment.metric]
  for (const episode of episodes) {
    if (episode.experimentId !== experiment._id || !episode.variantKey) continue
    if (episode.status !== 'measured' && episode.status !== 'published') continue
    const entry = stats.get(episode.variantKey)
    if (!entry) continue
    const snapshots = latestPerPublication(
      await ctx.db
        .query('metricSnapshots')
        .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
        .collect()
    )
    const views = snapshots.reduce((sum, snapshot) => sum + snapshot.counts.views, 0)
    const follows = snapshots.reduce((sum, snapshot) => sum + snapshot.counts.follows, 0)
    const watched = snapshots.reduce((sum, snapshot) => sum + snapshot.counts.views * snapshot.counts.watchRate, 0)
    const links = await ctx.db
      .query('links')
      .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
      .collect()
    const clicks = links.reduce((sum, link) => sum + link.clicks, 0)
    const conversions = (
      await ctx.db
        .query('conversions')
        .withIndex('by_persona_time', (q) => q.eq('personaId', experiment.personaId))
        .collect()
    ).filter((conversion) => conversion.episodeId === episode._id)
    const signups = conversions.filter((conversion) => conversion.kind === 'signup').length
    const paid = conversions.filter((conversion) => conversion.kind === 'paid').length
    const successes = { views, watch_rate: Math.round(watched), follows, clicks, signups, paid }[experiment.metric]
    entry.episodes += 1
    entry.exposures += denominator === 'views' ? views : denominator === 'clicks' ? clicks : 1
    entry.successes += successes
  }
  return [...stats.values()]
}

// ---------------------------------------------------------------------------
// Persona chat
// ---------------------------------------------------------------------------

export const replyInChat = internalAction({
  args: { personaId: v.id('personas'), directive: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const { persona } = await ctx.runQuery(internal.internal.data.getPersona, { personaId: args.personaId })
    const history: Doc<'messages'>[] = await ctx.runQuery(internal.internal.agents.chatHistory, { personaId: args.personaId })
    const text = await llmProvider().reply({
      persona: {
        name: persona.name,
        handle: persona.handle,
        niche: persona.niche,
        tone: persona.tone,
        bible: persona.bible,
        pillars: persona.pillars,
      },
      history: history.map((message) => ({ author: message.author, text: message.text })),
      directive: args.directive,
    })
    await ctx.runMutation(internal.internal.agents.storeReply, { personaId: args.personaId, text })
  },
})

export const chatHistory = internalQuery({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<Doc<'messages'>[]> => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_persona', (q) => q.eq('personaId', args.personaId))
      .order('desc')
      .take(20)
    return messages.reverse()
  },
})

export const storeReply = internalMutation({
  args: { personaId: v.id('personas'), text: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert('messages', { personaId: args.personaId, author: 'persona', text: args.text, createdAt: Date.now() })
  },
})
