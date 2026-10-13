import { v } from 'convex/values'
import { canTransition, EPISODE_STATUS_LABELS, isPost, textEditable } from '@influstep/shared'
import { mutation, query } from '../_generated/server'
import { assertXTitleFits } from '../core/attribution'
import { hourAt, instantAt } from '../core/dates'
import { activeDiscountCodeFor } from '../core/discounts'
import { approveEpisode, setEpisodePlatforms, startProduction } from '../core/episodes'
import { earliestPublishAt, formatFor, platformsOf } from '../core/formats'
import { savePost } from '../core/posts'
import { countConversions } from '../core/report'
import { workspaceOf } from '../core/workspace'
import { applyEvent } from '../internal/data'
import { enqueueJob } from '../jobs/queue'
import { episodePostValidator, platformValidator, scriptValidator } from '../lib/validators'
import { refusal } from '../lib/errors'

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
      // Where the episode may go: the page offers a subset of these.
      personaPlatforms: platformsOf(persona),
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
    if (isPost(episode.kind)) throw refusal('A post has no script; edit the post instead.')
    if (!textEditable(episode.status)) {
      throw refusal(`The script is locked once recording starts; this episode is at "${EPISODE_STATUS_LABELS[episode.status]}".`)
    }
    // X posts the title as the video's text. Approval checks it too, but an edit after approval (waiting on a sign-in, or
    // failed) starts production without passing approval again, so the edit itself is refused.
    if (episode.platforms.includes('x')) assertXTitleFits(args.title)
    await ctx.db.patch(args.episodeId, { title: args.title, hook: args.script.hook, script: args.script, updatedAt: Date.now() })
  },
})

/** Save a post the operator edited. It refuses with the first thing X would not take (shared `postProblems`). */
export const updatePost = mutation({
  args: { episodeId: v.id('episodes'), title: v.string(), post: episodePostValidator },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) throw new Error('episode not found')
    if (!textEditable(episode.status)) {
      throw refusal(`The post is locked once it is approved; this episode is at "${EPISODE_STATUS_LABELS[episode.status]}".`)
    }
    await savePost(ctx, args.episodeId, { title: args.title, post: args.post })
  },
})

/** Narrow or widen where the episode goes, within the persona's platforms. Open until recording starts. */
export const setPlatforms = mutation({
  args: { episodeId: v.id('episodes'), platforms: v.array(platformValidator) },
  handler: async (ctx, args) => setEpisodePlatforms(ctx, args.episodeId, args.platforms),
})

export const approve = mutation({
  args: { episodeId: v.id('episodes') },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) throw new Error('episode not found')
    if (episode.status !== 'scripted')
      throw refusal(`Only an episode at "Needs approval" can be approved; this one is at "${EPISODE_STATUS_LABELS[episode.status]}".`)
    if (episode.kind === 'video' && episode.shots.length === 0) throw refusal('The episode has no shots to record.')
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
    // An image post's rendered card locks its card title (core/posts.ts). The rewrite gets a new card title, and approval
    // renders it again, so the old card goes and the title opens for the writer and the operator.
    if (episode.kind === 'image') await ctx.db.patch(args.episodeId, { renders: [] })
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
    if (episode.status !== 'failed')
      throw refusal(`Only a failed episode can be retried; this one is at "${EPISODE_STATUS_LABELS[episode.status]}".`)
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
    // A written video or image post failed while rendering: render again.
    const rendersAgain = episode.kind === 'video' ? episode.shots.length > 0 : episode.kind === 'image' && episode.post !== undefined
    if (rendersAgain) {
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
    if (!canTransition(episode.status, 'killed'))
      throw refusal(`An episode at "${EPISODE_STATUS_LABELS[episode.status]}" cannot be killed.`)
    const persona = await ctx.db.get(episode.personaId)
    if (!persona) throw new Error('persona not found')
    const publications = await ctx.db
      .query('publications')
      .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
      .collect()
    // A post keeps its slot's hour on the new day, and so does its X publication.
    if (isPost(episode.kind)) {
      const scheduledAt = instantAt(args.plannedFor, hourAt(episode.scheduledAt, persona.timezone), persona.timezone)
      await ctx.db.patch(args.episodeId, { plannedFor: args.plannedFor, scheduledAt, updatedAt: Date.now() })
      for (const publication of publications) {
        if (publication.status === 'queued') await ctx.db.patch(publication._id, { scheduledAt })
      }
      return
    }
    const scheduledAt = earliestPublishAt(persona, episode.platforms, args.plannedFor)
    await ctx.db.patch(args.episodeId, { plannedFor: args.plannedFor, scheduledAt, updatedAt: Date.now() })
    // Each queued publication keeps its platform's hour on the new day.
    for (const publication of publications) {
      if (publication.status !== 'queued') continue
      const hour = formatFor(persona, publication.platform).publishHour
      await ctx.db.patch(publication._id, { scheduledAt: instantAt(args.plannedFor, hour, persona.timezone) })
    }
  },
})
