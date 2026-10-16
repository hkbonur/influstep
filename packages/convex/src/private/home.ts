import { EPISODE_STATUSES, waitsOnOperator } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import { query } from '../_generated/server'
import { reportWindow } from '../core/report'

/**
 * The home overview above the calendar (docs/plan.md, slice 14): the
 * operator's three questions in one glance. What waits on them, what the
 * personas changed on their own this week, and what each persona earned over
 * the report's window.
 */

/** How many of the waiting episodes and of the week's changes are named; the rest are counted. */
const SHOWN = 4
/** The changes of "this week": the last seven days, whatever the persona's timezone. */
const WEEK_MS = 7 * 86_400_000
/** The report's window, so the earnings here are the workspace report's own. */
const EARNED_DAYS = 28

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const personas = await ctx.db.query('personas').collect()
    const byId = new Map<Id<'personas'>, Doc<'personas'>>(personas.map((persona) => [persona._id, persona]))
    const who = (personaId: Id<'personas'>) => {
      const persona = byId.get(personaId)
      if (!persona) throw new Error(`persona ${personaId} not found`)
      return { _id: persona._id, name: persona.name, color: persona.color }
    }

    // What waits: the episodes that wait on the operator (shared waitsOnOperator) and the failed ones, the soonest
    // first; the open checklist; and the replies on X drafted for the operator to post.
    const waiting: Doc<'episodes'>[] = []
    for (const status of EPISODE_STATUSES.filter((candidate) => waitsOnOperator(candidate) || candidate === 'failed')) {
      waiting.push(
        ...(await ctx.db
          .query('episodes')
          .withIndex('by_status', (q) => q.eq('status', status))
          .collect())
      )
    }
    waiting.sort((a, b) => a.scheduledAt - b.scheduledAt)
    const checklist = await ctx.db
      .query('checklistItems')
      .withIndex('by_status', (q) => q.eq('status', 'open'))
      .collect()
    const replies = []
    for (const persona of personas) {
      const drafts = await ctx.db
        .query('replies')
        .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'draft'))
        .collect()
      if (drafts.length > 0) replies.push({ persona: who(persona._id), drafts: drafts.length })
    }

    // What changed on its own: the journal entries the analyst and the researcher wrote this week, newest first.
    const changes: Doc<'journal'>[] = []
    for (const persona of personas) {
      const entries = await ctx.db
        .query('journal')
        .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id).gte('createdAt', now - WEEK_MS))
        .collect()
      changes.push(...entries.filter((entry) => entry.actor !== 'operator'))
    }
    changes.sort((a, b) => b.createdAt - a.createdAt)

    // What it earned: each persona's value over the window, from the report's own reading.
    const earned = []
    let currency: string | null = null
    for (const persona of personas) {
      const window = await reportWindow(ctx, persona, EARNED_DAYS, now)
      currency = window.currency
      earned.push({ persona: who(persona._id), value: window.funnel.value, paid: window.funnel.paid, mock: window.funnel.mock })
    }
    earned.sort((a, b) => b.value - a.value || b.paid - a.paid)

    return {
      waits: {
        episodes: waiting
          .slice(0, SHOWN)
          .map((episode) => ({ _id: episode._id, title: episode.title, status: episode.status, persona: who(episode.personaId) })),
        episodeCount: waiting.length,
        checklist: checklist.length,
        replies,
      },
      changes: {
        entries: changes.slice(0, SHOWN).map((entry) => ({
          _id: entry._id,
          text: entry.text,
          kind: entry.kind,
          actor: entry.actor,
          createdAt: entry.createdAt,
          persona: who(entry.personaId),
        })),
        count: changes.length,
      },
      earned: {
        days: EARNED_DAYS,
        currency,
        personas: earned,
        total: earned.reduce((sum, row) => sum + row.value, 0),
        mock: earned.some((row) => row.mock),
      },
    }
  },
})
