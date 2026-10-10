import { v } from 'convex/values'
import { variantRate } from '@influstep/shared'
import { query } from '../_generated/server'
import { addDays, dayKey } from '../core/dates'
import { buildFunnel, buildTrend, countConversions, latestPerPublication } from '../core/report'
import { workspaceOf } from '../core/workspace'
import { variantStatsFor } from '../internal/agents'

const TREND_DAYS = 28
const TOP_BY_VALUE = 5

/** One screen per persona: funnel, trend, experiments, the episode table, and what the discount codes did. */
export const forPersona = query({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) return null
    const workspace = await workspaceOf(ctx, persona)
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
    const funnel = buildFunnel({ snapshots, clicks: clicks.length, conversions, valuePerPaid: workspace.valuePerPaid })
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
        ...countConversions(
          conversions.filter((conversion) => conversion.episodeId === episode._id),
          workspace.valuePerPaid
        ),
      })
    }
    episodes.sort((a, b) => (a.plannedFor < b.plannedFor ? 1 : -1))
    const topByValue = episodes
      .filter((episode) => episode.value > 0 || episode.clicks > 0)
      .sort((a, b) => b.value - a.value || b.clicks - a.clicks)
      .slice(0, TOP_BY_VALUE)

    // Every code the persona was given, active ones first, newest first within each group.
    const codes = (
      await ctx.db
        .query('discountCodes')
        .withIndex('by_persona_active', (q) => q.eq('personaId', persona._id))
        .collect()
    ).sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt - a.createdAt)
    const discountCodes = []
    for (const code of codes) {
      const episode = code.episodeId ? await ctx.db.get(code.episodeId) : null
      discountCodes.push({
        _id: code._id,
        code: code.code,
        offer: code.offer,
        redemptions: code.redemptions,
        active: code.active,
        episodeTitle: episode?.title ?? null,
      })
    }

    return {
      persona,
      currency: workspace.currency,
      funnel,
      trend,
      experiments,
      episodes,
      topByValue,
      discountCodes,
      windowDays: TREND_DAYS,
    }
  },
})
