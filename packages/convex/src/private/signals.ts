import { v } from 'convex/values'
import { signalFreshness, type SignalStatus } from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import { createIdea } from '../core/episodes'
import { signalConcept } from '../core/planner'
import { sponsorSegmentValidator } from '../lib/validators'

/** How many signals the Signals page lists: the freshest, so the page never hides one fresher than a row it shows. */
const LIST_LIMIT = 200

/** The statuses the Signals page lists: a dismissed signal is gone from it. */
const LISTED_STATUSES = ['new', 'used'] as const satisfies readonly SignalStatus[]

/**
 * The Signals page: the persona's signals, or every persona's, that were not
 * dismissed, freshest first (shared `signalFreshness`, the rank the planner
 * and the last check use), newest found first among equals. Ranked before the
 * cut, so a signal found again this hour, whose first find is days old, is
 * listed by how fresh it is now.
 */
export const list = query({
  args: { personaId: v.optional(v.id('personas')) },
  handler: async (ctx, args) => {
    const personas = await ctx.db.query('personas').collect()
    const listed = args.personaId === undefined ? personas : personas.filter((persona) => persona._id === args.personaId)
    const signals: Doc<'signals'>[] = []
    for (const persona of listed) {
      for (const status of LISTED_STATUSES) {
        signals.push(
          ...(await ctx.db
            .query('signals')
            .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', status))
            .collect())
        )
      }
    }
    const now = Date.now()
    return signals
      .map((signal) => ({ signal, freshness: signalFreshness(signal, now) }))
      .sort((a, b) => b.freshness - a.freshness || b.signal.foundAt - a.signal.foundAt)
      .slice(0, LIST_LIMIT)
      .map(({ signal }) => {
        const persona = listed.find((candidate) => candidate._id === signal.personaId)
        if (!persona) throw new Error(`signal ${signal._id} was read for persona ${signal.personaId}, which is not listed`)
        return { ...signal, personaName: persona.name, personaHandle: persona.handle }
      })
  },
})

export const dismiss = mutation({
  args: { signalId: v.id('signals') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.signalId, { status: 'dismissed' })
  },
})

/** One click from a signal to an idea; the writer picks it up the day before it goes out (core `queueScriptIfDue`). */
export const makeEpisode = mutation({
  args: { signalId: v.id('signals'), plannedFor: v.string(), sponsorSegment: v.optional(sponsorSegmentValidator) },
  handler: async (ctx, args) => {
    const signal = await ctx.db.get(args.signalId)
    if (!signal) throw new Error('signal not found')
    const persona = await ctx.db.get(signal.personaId)
    if (!persona) throw new Error('persona not found')
    const pillar =
      persona.pillars.find((candidate) => signal.topics.some((topic) => candidate.toLowerCase().includes(topic.toLowerCase()))) ??
      persona.pillars[0] ??
      ''
    return createIdea(ctx, persona, {
      kind: 'video',
      personaId: persona._id,
      plannedFor: args.plannedFor,
      concept: signalConcept(signal.title),
      pillar,
      sponsorSegment: args.sponsorSegment ?? 'none',
      signalIds: [signal._id],
    })
  },
})
