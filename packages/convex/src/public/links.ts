import { v } from 'convex/values'
import { buildAttributedUrl } from '@influstep/shared'
import { mutation, query } from '../_generated/server'

/**
 * Tracked links and the link in bio (ADR 0003). Unauthenticated: the worker
 * calls these for every viewer who clicks.
 */

/** Counts the click and returns where to send the viewer, with UTM parameters. */
export const click = mutation({
  args: { slug: v.string(), referrer: v.optional(v.string()), country: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ target: string } | null> => {
    const link = await ctx.db
      .query('links')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first()
    if (!link) return null
    const persona = await ctx.db.get(link.personaId)
    if (!persona) return null
    const episode = link.episodeId ? await ctx.db.get(link.episodeId) : null
    await ctx.db.patch(link._id, { clicks: link.clicks + 1 })
    await ctx.db.insert('linkClicks', {
      linkId: link._id,
      personaId: persona._id,
      episodeId: link.episodeId,
      at: Date.now(),
      referrer: args.referrer,
      country: args.country,
    })
    return {
      target: buildAttributedUrl(link.target, {
        personaHandle: persona.handle,
        platform: link.platform ?? 'bio',
        episodeSlug: episode?.slug,
        variantKey: episode?.variantKey,
      }),
    }
  },
})

/** What the link-in-bio page shows: the persona, its sponsor link, and the latest published episodes. */
export const bio = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const persona = await ctx.db
      .query('personas')
      .withIndex('by_handle', (q) => q.eq('handle', args.handle))
      .first()
    if (!persona) return null
    const workspace = await ctx.db.get(persona.workspaceId)
    if (!workspace) return null
    const links = await ctx.db
      .query('links')
      .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
      .collect()
    const bioLink = links.find((link) => link.episodeId === undefined && link.platform === undefined)
    const publications = (
      await ctx.db
        .query('publications')
        .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
        .collect()
    )
      .filter((publication) => publication.status === 'live' && publication.url)
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
      .slice(0, 12)
    return {
      name: persona.name,
      handle: persona.handle,
      bio: persona.bio,
      sponsorName: workspace.sponsorName,
      sponsorSlug: bioLink?.slug ?? null,
      episodes: publications.map((publication) => ({
        title: publication.title,
        platform: publication.platform,
        url: publication.url ?? '',
      })),
    }
  },
})
