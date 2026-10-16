import { v } from 'convex/values'
import { MEDIA_BUDGET, hasPresenter } from '@influstep/shared'
import type { Id } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import { regenerateBeat, requestGeneration, requestPortrait, spentToday } from '../core/media'
import { workspaceOf } from '../core/workspace'
import { refusal } from '../lib/errors'
import { mediaKindValidator } from '../lib/validators'

/**
 * Generated media for the operator (docs/plan.md, slice 15): a picture from a
 * prompt on the Assets page, a picture made again when it misses, and where
 * the day's budget stands.
 */

/** How long a failed or finished generation stays on the Assets page's list of what the producer is making. */
const RECENT_MS = 24 * 60 * 60 * 1000

export const generate = mutation({
  args: { personaId: v.id('personas'), kind: mediaKindValidator, prompt: v.string() },
  handler: async (ctx, args): Promise<Id<'generations'>> => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    return requestGeneration(ctx, persona, { kind: args.kind, prompt: args.prompt, now: Date.now() })
  },
})

/** A portrait of the persona's presenter, from what the operator says it looks like; it leads the look once made. */
export const generatePortrait = mutation({
  args: { personaId: v.id('personas'), description: v.string() },
  handler: async (ctx, args): Promise<Id<'generations'>> => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    return requestPortrait(ctx, persona, args.description, Date.now())
  },
})

/** The beat's picture missed: the producer makes it again from the same prompt. */
export const regenerateForBeat = mutation({
  args: { episodeId: v.id('episodes'), beatIndex: v.number() },
  handler: async (ctx, args): Promise<Id<'generations'>> => regenerateBeat(ctx, args.episodeId, args.beatIndex, Date.now()),
})

/** A generated asset missed: a new one from the same prompt joins the library beside it. */
export const regenerateAsset = mutation({
  args: { assetId: v.id('assets') },
  handler: async (ctx, args): Promise<Id<'generations'>> => {
    const generation = await ctx.db
      .query('generations')
      .withIndex('by_asset', (q) => q.eq('assetId', args.assetId))
      .first()
    if (!generation) throw refusal('This asset was not generated, so there is no prompt to make it again from.')
    const persona = await ctx.db.get(generation.personaId)
    if (!persona) throw new Error(`persona ${generation.personaId} not found`)
    // A portrait missed: a new one from the same words, which leads the look once made.
    if (generation.portrait) return requestPortrait(ctx, persona, generation.prompt, Date.now())
    return requestGeneration(ctx, persona, { kind: generation.kind, prompt: generation.prompt, now: Date.now() })
  },
})

/** What the Assets page shows of the producer's generating: the day's spend against the budget, and what is being made or failed lately. */
export const forPersona = query({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) return null
    const now = Date.now()
    const recent = await ctx.db
      .query('generations')
      .withIndex('by_persona_created', (q) => q.eq('personaId', persona._id).gte('createdAt', now - RECENT_MS))
      .order('desc')
      .collect()
    // An asset made for the Assets page is in the library; a beat's picture shows on its episode. What is left is in flight or failed.
    const open = recent.filter((generation) => generation.status !== 'done' && generation.episodeId === undefined)
    const workspace = await workspaceOf(ctx, persona)
    return {
      sponsorName: workspace.sponsorName,
      // A look with a presenter can be given a portrait from the page; one without has no face to draw.
      presenter: persona.appearance !== undefined && hasPresenter(persona.appearance.style),
      spent: await spentToday(ctx, persona, now),
      budget: MEDIA_BUDGET,
      generations: open.map((generation) => ({
        _id: generation._id,
        kind: generation.kind,
        prompt: generation.prompt,
        status: generation.status,
        error: generation.error ?? null,
        createdAt: generation.createdAt,
      })),
      // The prompt behind each generated asset of the library, so the page can offer Generate again on it.
      assetPrompts: (
        await ctx.db
          .query('generations')
          .withIndex('by_persona_created', (q) => q.eq('personaId', persona._id))
          .collect()
      ).flatMap((generation) => (generation.assetId === undefined ? [] : [{ assetId: generation.assetId, prompt: generation.prompt }])),
    }
  },
})

/** Each persona's generating today against the daily budget, as the Providers page shows it beside the media provider. */
export const budgets = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const spend = []
    for (const persona of await ctx.db.query('personas').collect()) {
      spend.push({ personaId: persona._id, name: persona.name, ...(await spentToday(ctx, persona, now)) })
    }
    return { budget: MEDIA_BUDGET, spend }
  },
})
