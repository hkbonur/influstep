import { v } from 'convex/values'
import { variantRate } from '@influstep/shared'
import { query } from '../_generated/server'
import { addDays, dayKey } from '../core/dates'
import { buildFunnel, buildTrend, latestPerPublication } from '../core/report'
import { variantStatsFor } from '../internal/agents'

const TREND_DAYS = 28

/** One screen per persona: funnel, trend, experiments, and the episode table. */
export const forPersona = query({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) return null
    const since = Date.now() - TREND_DAYS * 86_400_000
    const snapshots = await ctx.db
      .query('metricSnapshots')
      .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id))
      .collect()
    const clicks = await ctx.db
      .query('linkClicks')
      .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id))
      .collect()
    const conversions = await ctx.db
      .query('conversions')
      .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id))
      .collect()
    const funnel = buildFunnel({ snapshots, clicks: clicks.length, conversions })
    const today = dayKey(Date.now(), persona.timezone)
    const days = Array.from({ length: TREND_DAYS }, (_, index) => addDays(today, index - TREND_DAYS + 1))
    const trend = buildTrend({
      days,
      snapshots: snapshots.filter((snapshot) => snapshot.takenAt >= since),
      clicks: clicks.filter((click) => click.at >= since).map((click) => ({ day: dayKey(click.at, persona.timezone) })),
      conversions: conversions
        .filter((conversion) => conversion.at >= since)
        .map((conversion) => ({ day: dayKey(conversion.at, persona.timezone), kind: conversion.kind })),
      snapshotDay: (snapshot) => dayKey(snapshot.takenAt, persona.timezone),
    })

    const experiments = []
    for (const experiment of await ctx.db
      .query('experiments')
      .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id))
      .collect()) {
      const stats = await variantStatsFor(ctx, experiment)
      experiments.push({ ...experiment, stats: stats.map((stat) => ({ ...stat, rate: variantRate(stat) })) })
    }

    const latest = latestPerPublication(snapshots)
    const episodes = []
    for (const episode of await ctx.db
      .query('episodes')
      .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
      .collect()) {
      if (episode.status !== 'published' && episode.status !== 'measured') continue
      const own = latest.filter((snapshot) => snapshot.episodeId === episode._id)
      const links = await ctx.db
        .query('links')
        .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
        .collect()
      episodes.push({
        _id: episode._id,
        title: episode.title,
        plannedFor: episode.plannedFor,
        status: episode.status,
        sponsorSegment: episode.sponsorSegment,
        variantKey: episode.variantKey,
        views: own.reduce((sum, snapshot) => sum + snapshot.counts.views, 0),
        follows: own.reduce((sum, snapshot) => sum + snapshot.counts.follows, 0),
        clicks: links.reduce((sum, link) => sum + link.clicks, 0),
        signups: conversions.filter((conversion) => conversion.episodeId === episode._id && conversion.kind === 'signup').length,
        paid: conversions.filter((conversion) => conversion.episodeId === episode._id && conversion.kind === 'paid').length,
      })
    }
    episodes.sort((a, b) => (a.plannedFor < b.plannedFor ? 1 : -1))

    return { persona, funnel, trend, experiments, episodes, windowDays: TREND_DAYS }
  },
})
