import { v } from 'convex/values'
import type { Platform } from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import { query } from '../_generated/server'
import { addDays } from '../core/dates'

export interface CalendarEpisode {
  _id: Doc<'episodes'>['_id']
  title: string
  status: Doc<'episodes'>['status']
  sponsorSegment: Doc<'episodes'>['sponsorSegment']
  /** Where this episode goes (the episode's own platforms, not the persona's). */
  platforms: Platform[]
  scheduledAt: number
  plannedFor: string
  variantKey?: string
  error?: string
  persona: { _id: Doc<'personas'>['_id']; name: string; handle: string }
}

/** Seven days from `weekStart`, every persona, episodes ordered by publish time. */
export const week = query({
  args: { weekStart: v.string(), personaId: v.optional(v.id('personas')) },
  handler: async (ctx, args): Promise<{ days: { day: string; episodes: CalendarEpisode[] }[] }> => {
    const personas = new Map((await ctx.db.query('personas').collect()).map((persona) => [persona._id, persona]))
    const days = []
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addDays(args.weekStart, offset)
      const rows = await ctx.db
        .query('episodes')
        .withIndex('by_day', (q) => q.eq('plannedFor', day))
        .collect()
      const episodes: CalendarEpisode[] = []
      for (const episode of rows) {
        if (args.personaId && episode.personaId !== args.personaId) continue
        const persona = personas.get(episode.personaId)
        if (!persona) continue
        episodes.push({
          _id: episode._id,
          title: episode.title,
          status: episode.status,
          sponsorSegment: episode.sponsorSegment,
          platforms: episode.platforms,
          scheduledAt: episode.scheduledAt,
          plannedFor: episode.plannedFor,
          variantKey: episode.variantKey,
          error: episode.error,
          persona: { _id: persona._id, name: persona.name, handle: persona.handle },
        })
      }
      episodes.sort((a, b) => a.scheduledAt - b.scheduledAt)
      days.push({ day, episodes })
    }
    return { days }
  },
})
