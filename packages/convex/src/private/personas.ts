import { v } from 'convex/values'
import { readsAsDirective } from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import { dayKey, weekStart } from '../core/dates'
import {
  activeDiscountCodes,
  giveDiscountCode as giveDiscountCodeRule,
  retireDiscountCode as retireDiscountCodeRule,
} from '../core/discounts'
import { createTrackedLink, reconcilePlatformDrop } from '../core/episodes'
import { assertFormats, platformsOf } from '../core/formats'
import { workingPersonaIds } from '../core/jobs'
import { requireWorkspace, workspaceOf } from '../core/workspace'
import { enqueueJob } from '../jobs/queue'
import { personaColorValidator, platformFormatValidator } from '../lib/validators'
import { refusal } from '../lib/errors'

const personaFields = {
  name: v.string(),
  color: personaColorValidator,
  handle: v.string(),
  niche: v.string(),
  tone: v.string(),
  bio: v.string(),
  bible: v.string(),
  pillars: v.array(v.string()),
  // One format per platform the persona publishes on (core/formats.ts checks the list).
  formats: v.array(platformFormatValidator),
  voiceId: v.string(),
  sponsorDial: v.number(),
  sponsorRampEpisodes: v.number(),
  episodesPerWeek: v.number(),
  autoApprove: v.boolean(),
  timezone: v.string(),
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const personas = await ctx.db.query('personas').collect()
    const working = await workingPersonaIds(ctx)
    const out = []
    for (const persona of personas) {
      const episodes = await ctx.db
        .query('episodes')
        .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
        .collect()
      const open = await ctx.db
        .query('checklistItems')
        .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'open'))
        .collect()
      out.push({
        ...persona,
        working: working.has(persona._id),
        counts: {
          episodes: episodes.length,
          published: episodes.filter((episode) => episode.status === 'published' || episode.status === 'measured').length,
          needsApproval: episodes.filter((episode) => episode.status === 'scripted').length,
          failed: episodes.filter((episode) => episode.status === 'failed').length,
          checklist: open.length,
        },
      })
    }
    return out.sort((a, b) => a.createdAt - b.createdAt)
  },
})

export const get = query({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) return null
    const workspace = await workspaceOf(ctx, persona)
    const messages = (
      await ctx.db
        .query('messages')
        .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
        .order('desc')
        .take(60)
    ).reverse()
    const directives = await ctx.db
      .query('directives')
      .withIndex('by_persona_active', (q) => q.eq('personaId', persona._id).eq('active', true))
      .collect()
    const checklist = await ctx.db
      .query('checklistItems')
      .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'open'))
      .collect()
    const episodes = (
      await ctx.db
        .query('episodes')
        .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
        .collect()
    ).sort((a, b) => (a.plannedFor < b.plannedFor ? 1 : -1))
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
      .order('desc')
      .take(12)
    // Not from `jobs` above: those are only the newest few, and a job queued for hours can sit behind them.
    const working = (await workingPersonaIds(ctx)).has(persona._id)
    const bioLink = (
      await ctx.db
        .query('links')
        .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
        .collect()
    ).find((link) => !link.episodeId && !link.platform)
    // The codes in force, the persona-wide one first, then the episode-bound ones.
    const codes = (await activeDiscountCodes(ctx, persona._id)).sort(
      (a, b) => Number(a.episodeId !== undefined) - Number(b.episodeId !== undefined) || b.createdAt - a.createdAt
    )
    const discountCodes = codes.map((code) => ({
      _id: code._id,
      code: code.code,
      offer: code.offer,
      redemptions: code.redemptions,
      active: code.active,
      episodeId: code.episodeId,
      episodeTitle: code.episodeId ? (episodes.find((episode) => episode._id === code.episodeId)?.title ?? null) : null,
    }))
    return {
      persona,
      sponsorName: workspace.sponsorName,
      appUrl: workspace.appUrl,
      currency: workspace.currency,
      messages,
      directives,
      checklist,
      episodes,
      jobs,
      working,
      bioLink,
      discountCodes,
    }
  },
})

export const create = mutation({
  args: personaFields,
  handler: async (ctx, args) => {
    assertFormats(args.formats)
    const workspace = await requireWorkspace(ctx)
    const taken = await ctx.db
      .query('personas')
      .withIndex('by_handle', (q) => q.eq('handle', args.handle))
      .first()
    if (taken) throw refusal(`The handle ${args.handle} is taken.`)
    const personaId = await ctx.db.insert('personas', { ...args, workspaceId: workspace._id, paused: false, createdAt: Date.now() })
    const persona = await ctx.db.get(personaId)
    if (!persona) throw new Error('persona vanished')
    await createTrackedLink(ctx, { persona, target: workspace.sponsorUrl })
    await enqueueJob(ctx, { kind: 'poll_signals', payload: { personaId }, personaId })
    return personaId
  },
})

/** Save the settings. A platform that leaves the list takes its episodes with it (core/episodes.ts, reconcilePlatformDrop). */
export const update = mutation({
  args: { personaId: v.id('personas'), ...personaFields },
  handler: async (ctx, args) => {
    const { personaId, ...fields } = args
    assertFormats(fields.formats)
    const persona = await ctx.db.get(personaId)
    if (!persona) throw new Error('persona not found')
    const next = new Set(fields.formats.map((format) => format.platform))
    const dropped = platformsOf(persona).filter((platform) => !next.has(platform))
    await ctx.db.patch(personaId, fields)
    await reconcilePlatformDrop(ctx, personaId, dropped)
  },
})

export const setPaused = mutation({
  args: { personaId: v.id('personas'), paused: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.personaId, { paused: args.paused })
  },
})

/** Queue the writer's plan for the week that holds `weekStart` (today's week by default). */
export const planWeek = mutation({
  args: { personaId: v.id('personas'), weekStart: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error('persona not found')
    const start = args.weekStart ?? weekStart(dayKey(Date.now(), persona.timezone))
    return enqueueJob(ctx, { kind: 'plan_week', payload: { personaId: persona._id, weekStart: start }, personaId: persona._id })
  },
})

export const pollSignals = mutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args) =>
    enqueueJob(ctx, { kind: 'poll_signals', payload: { personaId: args.personaId }, personaId: args.personaId }),
})

export const pullMetrics = mutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args) =>
    enqueueJob(ctx, { kind: 'pull_metrics', payload: { personaId: args.personaId }, personaId: args.personaId }),
})

/** Chat: the operator's message is stored, becomes a directive when it reads like one, and the persona replies. */
export const sendMessage = mutation({
  args: { personaId: v.id('personas'), text: v.string() },
  handler: async (ctx, args): Promise<{ directiveId?: Doc<'directives'>['_id'] }> => {
    const text = args.text.trim()
    if (!text) throw refusal('The message is empty.')
    const now = Date.now()
    let directiveId: Doc<'directives'>['_id'] | undefined
    if (readsAsDirective(text))
      directiveId = await ctx.db.insert('directives', { personaId: args.personaId, text, active: true, createdAt: now })
    await ctx.db.insert('messages', { personaId: args.personaId, author: 'operator', text, directiveId, createdAt: now })
    await ctx.scheduler.runAfter(0, internal.internal.agents.replyInChat, {
      personaId: args.personaId,
      directive: directiveId ? text : undefined,
    })
    return { directiveId }
  },
})

export const withdrawDirective = mutation({
  args: { directiveId: v.id('directives') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.directiveId, { active: false, withdrawnAt: Date.now() })
  },
})

/** Hand the persona a code the operator created in Polar; with an episode, the code is for that episode only. */
export const giveDiscountCode = mutation({
  args: { personaId: v.id('personas'), code: v.string(), offer: v.string(), episodeId: v.optional(v.id('episodes')) },
  handler: async (ctx, args) => giveDiscountCodeRule(ctx, args),
})

export const retireDiscountCode = mutation({
  args: { discountCodeId: v.id('discountCodes') },
  handler: async (ctx, args) => retireDiscountCodeRule(ctx, args.discountCodeId),
})
