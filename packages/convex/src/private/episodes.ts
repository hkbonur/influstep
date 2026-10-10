import { v } from 'convex/values'
import { canTransition } from '@influstep/shared'
import { mutation, query } from '../_generated/server'
import { instantAt } from '../core/dates'
import { activeDiscountCodeFor } from '../core/discounts'
import { approveEpisode, startProduction } from '../core/episodes'
import { countConversions } from '../core/report'
import { workspaceOf } from '../core/workspace'
import { applyEvent } from '../internal/data'
import { enqueueJob } from '../jobs/queue'
import { scriptValidator } from '../lib/validators'

export const get = query({
  args: { episodeId: v.id('episodes') },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) return null
    const persona = await ctx.db.get(episode.personaId)
    if (!persona) return null
    const workspace = await workspaceOf(ctx, persona)
    const publications = await ctx.db
      .query('publications')
      .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
      .collect()
    const links = await ctx.db
      .query('links')
      .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
      .collect()
    const checklist = await ctx.db
      .query('checklistItems')
      .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
      .collect()
    const jobs = (
      await ctx.db
        .query('jobs')
        .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
        .collect()
    ).sort((a, b) => b.createdAt - a.createdAt)
    const signals = []
    for (const signalId of episode.signalIds) {
      const signal = await ctx.db.get(signalId)
      if (signal) signals.push(signal)
    }
    const experiment = episode.experimentId ? await ctx.db.get(episode.experimentId) : null
    const renders = []
    for (const render of episode.renders) renders.push({ ...render, url: await ctx.storage.getUrl(render.storageId) })
    const snapshots = await ctx.db
      .query('metricSnapshots')
      .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
      .collect()
    // What this episode did for the sponsor: its clicks and the conversions tied to it.
    const conversions = (
      await ctx.db
        .query('conversions')
        .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id))
        .collect()
    ).filter((conversion) => conversion.episodeId === episode._id)
    const value = {
      clicks: links.reduce((sum, link) => sum + link.clicks, 0),
      ...countConversions(conversions, workspace.valuePerPaid),
      mock: conversions.some((conversion) => conversion.mock) || publications.some((publication) => publication.mock),
    }
    // The code in force now (what the next render gets) and the codes the written descriptions carry.
    const discountCode = await activeDiscountCodeFor(ctx, persona._id, episode._id)
    const codesInDescriptions = []
    for (const discountCodeId of new Set(publications.map((publication) => publication.discountCodeId))) {
      if (!discountCodeId) continue
      const code = await ctx.db.get(discountCodeId)
      if (!code) throw new Error(`discount code ${discountCodeId} of a publication of episode ${episode._id} not found`)
      codesInDescriptions.push({ code: code.code, offer: code.offer })
    }
    return {
      episode,
      persona,
      appUrl: workspace.appUrl,
      sponsorName: workspace.sponsorName,
      currency: workspace.currency,
      publications,
      links,
      checklist,
      jobs,
      signals,
      experiment,
      renders,
      snapshots,
      value,
      discountCode: discountCode ? { code: discountCode.code, offer: discountCode.offer } : null,
      codesInDescriptions,
    }
  },
})

export const updateScript = mutation({
  args: { episodeId: v.id('episodes'), title: v.string(), script: scriptValidator },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) throw new Error('episode not found')
    if (episode.status !== 'scripted' && episode.status !== 'idea' && episode.status !== 'waiting_on_you' && episode.status !== 'failed') {
      throw new Error(`the script of a ${episode.status} episode is locked`)
    }
    await ctx.db.patch(args.episodeId, { title: args.title, hook: args.script.hook, script: args.script, updatedAt: Date.now() })
  },
})

export const approve = mutation({
  args: { episodeId: v.id('episodes') },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) throw new Error('episode not found')
    if (episode.status !== 'scripted') throw new Error(`only a scripted episode can be approved, this one is ${episode.status}`)
    if (episode.shots.length === 0) throw new Error('the episode has no shots to record')
    await approveEpisode(ctx, args.episodeId)
  },
})

export const kill = mutation({
  args: { episodeId: v.id('episodes') },
  handler: async (ctx, args) => {
    await applyEvent(ctx, args.episodeId, { type: 'killed' })
  },
})

/** Send the episode back to the writer. */
export const rewrite = mutation({
  args: { episodeId: v.id('episodes') },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) throw new Error('episode not found')
    await applyEvent(ctx, args.episodeId, { type: 'rewrite' })
    await enqueueJob(ctx, {
      kind: 'write_script',
      payload: { episodeId: episode._id },
      personaId: episode.personaId,
      episodeId: episode._id,
    })
  },
})

/** Retry a failed episode from the step that failed. */
export const retry = mutation({
  args: { episodeId: v.id('episodes') },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) throw new Error('episode not found')
    if (episode.status !== 'failed') throw new Error(`only a failed episode can be retried, this one is ${episode.status}`)
    const persona = await ctx.db.get(episode.personaId)
    if (!persona) throw new Error('persona not found')
    const publications = await ctx.db
      .query('publications')
      .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
      .collect()
    if (publications.length > 0) {
      for (const publication of publications)
        if (publication.status === 'failed') await ctx.db.patch(publication._id, { status: 'queued', error: undefined })
      await applyEvent(ctx, args.episodeId, { type: 'retry' }, 'scheduled')
      return
    }
    if (episode.shots.length > 0) {
      await applyEvent(ctx, args.episodeId, { type: 'retry' }, 'recording')
      await startProduction(ctx, episode, persona)
      return
    }
    await applyEvent(ctx, args.episodeId, { type: 'retry' }, 'idea')
    await enqueueJob(ctx, {
      kind: 'write_script',
      payload: { episodeId: episode._id },
      personaId: episode.personaId,
      episodeId: episode._id,
    })
  },
})

export const reschedule = mutation({
  args: { episodeId: v.id('episodes'), plannedFor: v.string() },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) throw new Error('episode not found')
    if (!canTransition(episode.status, 'killed')) throw new Error(`a ${episode.status} episode cannot move`)
    const persona = await ctx.db.get(episode.personaId)
    if (!persona) throw new Error('persona not found')
    const scheduledAt = instantAt(args.plannedFor, persona.publishHour, persona.timezone)
    await ctx.db.patch(args.episodeId, { plannedFor: args.plannedFor, scheduledAt, updatedAt: Date.now() })
    const publications = await ctx.db
      .query('publications')
      .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
      .collect()
    for (const publication of publications) if (publication.status === 'queued') await ctx.db.patch(publication._id, { scheduledAt })
  },
})
