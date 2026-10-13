import { v } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import { memoryView, rememberFromOperator, retireMemory } from '../core/memory'
import { refusal } from '../lib/errors'
import { operatorMemoryKindValidator } from '../lib/validators'

/** What the memory page reads: every entry of the persona with what its evidence names. */
export const list = query({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) return null
    return memoryView(ctx, persona)
  },
})

/** The operator adds a fact or a rule on the memory page; the chat adds one through core/chat.ts. */
export const add = mutation({
  args: { personaId: v.id('personas'), kind: operatorMemoryKindValidator, text: v.string() },
  handler: async (ctx, args): Promise<Id<'memories'>> => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    const outcome = await rememberFromOperator(ctx, persona, { kind: args.kind, text: args.text, now: Date.now() })
    switch (outcome.status) {
      case 'invalid':
        throw refusal(outcome.problem)
      case 'known':
        throw refusal(`${persona.name} already remembers that: "${outcome.text}"`)
      case 'stored':
        return outcome.memoryId
    }
  },
})

/** Forget a fact or a rule, or mark a problem resolved. The entry stays on the page, retired. */
export const retire = mutation({
  args: { memoryId: v.id('memories') },
  handler: async (ctx, args): Promise<void> => {
    await retireMemory(ctx, args.memoryId, Date.now())
  },
})
