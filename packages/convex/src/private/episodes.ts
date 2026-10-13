import { v } from 'convex/values'
import { EPISODE_STATUS_LABELS, hookOf, isPost, scriptProblems, textEditable } from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import { mutation, query, type QueryCtx } from '../_generated/server'
import { assertXTitleFits, descriptionFormatOf, publicationFooter, type DescriptionFooter } from '../core/attribution'
import { activeDiscountCodeFor } from '../core/discounts'
import {
  approveEpisode,
  formatAndShots,
  killEpisode,
  queueScriptIfDue,
  rescheduleEpisode,
  scriptBeingWritten,
  setEpisodePlatforms,
  startProduction,
} from '../core/episodes'
import { episodeEffectiveVariant, episodeVariant } from '../core/experiments'
import { platformsOf } from '../core/formats'
import { savePost } from '../core/posts'
import { countConversions } from '../core/report'
import { workspaceOf } from '../core/workspace'
import { applyEvent } from '../internal/data'
import { beatEditValidator, episodePostValidator, platformValidator } from '../lib/validators'
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
    // The code in force now: what every publication that has not gone out will carry, a failed one included.
    const discountCode = await activeDiscountCodeFor(ctx, persona._id, episode._id)
    // The publish package: each publication with the render it uploads and the footer dispatch adds around its body.
    const descriptionFormat = descriptionFormatOf(
      { variant: episodeVariant(episode, experiment), sponsorSegment: episode.sponsorSegment },
      persona.strategy?.defaults
    )
    const packaged: PackagedPublication[] = []
    for (const publication of publications) {
      const render = renders.find((candidate) => candidate.aspect === publication.aspect)
      const link = links.find((candidate) => candidate._id === publication.linkId)
      if (!link) throw new Error(`link ${publication.linkId} of publication ${publication._id} not found`)
      const sent = wentOut(publication)
      const footerCode = sent ? await stampedCode(ctx, publication) : discountCode
      packaged.push({
        ...publication,
        renderUrl: render?.url ?? null,
        footer: publicationFooter({ workspace, episode, publication, linkSlug: link.slug, discountCode: footerCode, descriptionFormat }),
        sent,
      })
    }
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
    // The codes the descriptions that went out carried, stamped on their publications at dispatch. A failed attempt's
    // stamp is left out: it never reached viewers, and a retry is composed and stamped again.
    const codesSent = []
    const sentCodeIds = new Set(publications.filter(wentOut).map((publication) => publication.discountCodeId))
    for (const discountCodeId of sentCodeIds) {
      if (!discountCodeId) continue
      const code = await ctx.db.get(discountCodeId)
      if (!code) throw new Error(`discount code ${discountCodeId} of a publication of episode ${episode._id} not found`)
      codesSent.push({ code: code.code, offer: code.offer })
    }
    return {
      episode,
      persona,
      // Where the episode may go: the page offers a subset of these.
      personaPlatforms: platformsOf(persona),
      appUrl: workspace.appUrl,
      sponsorName: workspace.sponsorName,
      currency: workspace.currency,
      publications: packaged,
      links,
      checklist,
      jobs,
      // An idea the writer is on now (core `scriptBeingWritten`, as the calendar and the persona page read it).
      writing: episode.status === 'idea' && (await scriptBeingWritten(ctx, episode._id)),
      signals,
      experiment,
      renders,
      snapshots,
      value,
      discountCode: discountCode ? { code: discountCode.code, offer: discountCode.offer } : null,
      codesSent,
    }
  },
})

/**
 * A publication as the episode page shows it in the publish package: the
 * storage URL of the render its aspect names (null when there is none, as for
 * a text post or a thread), what dispatch adds around its body (null on X,
 * where nothing is appended), and whether it went out, which decides both the
 * code in that footer and how the page labels it.
 */
type PackagedPublication = Doc<'publications'> & { renderUrl: string | null; footer: DescriptionFooter | null; sent: boolean }

/**
 * Handed to the runner or live: its description is fixed, with the code
 * stamped at dispatch. A failed publication has not gone out, since a retry
 * or a new render composes it again with the code in force then, and a
 * withdrawn one never will.
 */
function wentOut(publication: Doc<'publications'>): boolean {
  return publication.status === 'uploading' || publication.status === 'live'
}

/** The code a publication that went out carried, or null when none was in force then. */
async function stampedCode(ctx: { db: QueryCtx['db'] }, publication: Doc<'publications'>): Promise<Doc<'discountCodes'> | null> {
  if (publication.discountCodeId === undefined) return null
  const code = await ctx.db.get(publication.discountCodeId)
  if (!code) throw new Error(`discount code ${publication.discountCodeId} of publication ${publication._id} not found`)
  return code
}

/**
 * Save a video's script as the operator edited it: the title and each beat's
 * title and spoken line. The beats are the script the recording speaks, so
 * the shots and the format are derived from them again and the hook is read
 * from the first beat. The beat count, and each beat's tool and URL, stay the
 * writer's. The length is not checked: an operator may trim a script, and the
 * editor shows the spoken seconds instead.
 */
export const updateBeats = mutation({
  args: { episodeId: v.id('episodes'), title: v.string(), beats: v.array(beatEditValidator) },
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
    const stored = episode.shotPlan
    if (!stored) throw refusal('The writer has not written this script yet.')
    if (args.beats.length !== stored.length) throw refusal('Beats can be edited, not added or removed, here.')
    const shotPlan = stored.map((beat, index) => {
      const edit = args.beats[index]
      if (!edit) throw new Error(`beat ${index + 1} of episode ${episode._id} has no edit`)
      return { title: edit.title.trim(), voiceover: edit.voiceover.trim(), tool: beat.tool, url: beat.url }
    })
    const persona = await ctx.db.get(episode.personaId)
    if (!persona) throw new Error(`persona ${episode.personaId} not found`)
    const workspace = await workspaceOf(ctx, persona)
    const [problem] = scriptProblems(shotPlan, { sponsorSegment: episode.sponsorSegment, sponsorName: workspace.sponsorName })
    if (problem) throw refusal(problem)
    const { format, shots } = formatAndShots({
      persona,
      platforms: episode.platforms,
      draft: { shotPlan },
      sponsorName: workspace.sponsorName,
      length: await episodeEffectiveVariant(ctx, 'length', episode, persona),
    })
    await ctx.db.patch(args.episodeId, {
      title: args.title,
      shotPlan,
      format,
      shots,
      hook: hookOf(shotPlan),
      updatedAt: Date.now(),
    })
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
  handler: async (ctx, args) => killEpisode(ctx, args.episodeId),
})

/**
 * Send the episode back to the writer. It is an idea again, so it is written
 * the day before it goes out like any idea (core `queueScriptIfDue`): at once
 * when that day has come, else on its script day.
 */
export const rewrite = mutation({
  args: { episodeId: v.id('episodes') },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) throw new Error('episode not found')
    const persona = await ctx.db.get(episode.personaId)
    if (!persona) throw new Error('persona not found')
    await applyEvent(ctx, args.episodeId, { type: 'rewrite' })
    // An image post's rendered card locks its card title (core/posts.ts). The rewrite gets a new card title, and approval
    // renders it again, so the old card goes and the title opens for the writer and the operator.
    if (episode.kind === 'image') await ctx.db.patch(args.episodeId, { renders: [] })
    await queueScriptIfDue(ctx, persona, await rewritten(ctx, args.episodeId), Date.now())
  },
})

/** The episode as an event left it, for the rule that reads its new status. */
async function rewritten(ctx: QueryCtx, episodeId: Doc<'episodes'>['_id']): Promise<Doc<'episodes'>> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  return episode
}

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
    // A package never approved goes back to the operator as it was; nothing of it went out.
    if (publications.some((publication) => publication.status === 'draft')) {
      await applyEvent(ctx, args.episodeId, { type: 'retry' }, 'rendered')
      return
    }
    if (publications.length > 0) {
      // The code a failed attempt was stamped with never reached viewers; dispatch stamps the code in force when it goes again.
      for (const publication of publications) {
        if (publication.status !== 'failed') continue
        await ctx.db.patch(publication._id, { status: 'queued', error: undefined, discountCodeId: undefined })
      }
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
    await queueScriptIfDue(ctx, persona, await rewritten(ctx, args.episodeId), Date.now())
  },
})

export const reschedule = mutation({
  args: { episodeId: v.id('episodes'), plannedFor: v.string() },
  handler: async (ctx, args) => rescheduleEpisode(ctx, args.episodeId, args.plannedFor),
})
