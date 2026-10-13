import { v } from 'convex/values'
import { PLATFORMS, variantRate } from '@influstep/shared'
import { query } from '../_generated/server'
import { platformsOf } from '../core/formats'
import { buildFunnel, countConversions, latestPerPublication, reportWindow } from '../core/report'
import { workspaceOf } from '../core/workspace'
import { variantStatsFor } from '../core/experiments'

const TREND_DAYS = 28
const TOP_BY_VALUE = 5

/** One screen per persona: funnel, trend, experiments, the episode table, and what the discount codes did. */
export const forPersona = query({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) return null
    const workspace = await workspaceOf(ctx, persona)
    const now = Date.now()
    const since = now - TREND_DAYS * 86_400_000
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
    const { trend } = await reportWindow(ctx, persona, TREND_DAYS, now)

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

    // The persona against its own platforms, in PLATFORMS order: its live publications there, their
    // latest snapshot taken in the window, and the clicks on their tracked links. A platform the
    // persona has but has not published on yet is a row of zeros.
    const publications = await ctx.db
      .query('publications')
      .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
      .collect()
    const inWindow = latestPerPublication(snapshots.filter((snapshot) => snapshot.takenAt >= since))
    const platforms = []
    for (const platform of PLATFORMS.filter((candidate) => platformsOf(persona).includes(candidate))) {
      const own = publications.filter((publication) => publication.platform === platform && publication.status === 'live')
      const ownSnapshots = inWindow.filter((snapshot) => own.some((publication) => publication._id === snapshot.publicationId))
      let clicks = 0
      for (const publication of own) {
        const link = await ctx.db.get(publication.linkId)
        if (!link) throw new Error(`link ${publication.linkId} of publication ${publication._id} not found`)
        clicks += link.clicks
      }
      platforms.push({
        platform,
        views: ownSnapshots.reduce((sum, snapshot) => sum + snapshot.counts.views, 0),
        follows: ownSnapshots.reduce((sum, snapshot) => sum + snapshot.counts.follows, 0),
        likes: ownSnapshots.reduce((sum, snapshot) => sum + snapshot.counts.likes, 0),
        comments: ownSnapshots.reduce((sum, snapshot) => sum + snapshot.counts.comments, 0),
        clicks,
        publications: own.length,
      })
    }

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
      platforms,
      discountCodes,
      windowDays: TREND_DAYS,
    }
  },
})
