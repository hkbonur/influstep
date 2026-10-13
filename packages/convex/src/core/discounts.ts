import { EPISODE_STATUS_LABELS, normalizeDiscountCode } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { refusal } from '../lib/errors'

/**
 * Discount codes (docs/plan.md, "Value per episode"). The operator creates a
 * code in Polar by hand and hands it to a persona; a persona never mints one.
 * A code is either bound to one episode or persona-wide. Which code a
 * description carries, which code a new one replaces, and which row a
 * redemption belongs to are the rules here. No description is stored: dispatch
 * composes each one with the code in force at that moment (core/attribution.ts),
 * so giving or retiring a code reaches every publication not yet sent, drafts
 * included, without rewriting anything.
 */

type Reader = { db: QueryCtx['db'] }

/** Every code the persona was ever given, retired ones included: old videos keep their code, so the analyst polls them all. */
export async function discountCodesFor(ctx: Reader, personaId: Id<'personas'>): Promise<Doc<'discountCodes'>[]> {
  return ctx.db
    .query('discountCodes')
    .withIndex('by_persona_active', (q) => q.eq('personaId', personaId))
    .collect()
}

export async function activeDiscountCodes(ctx: Reader, personaId: Id<'personas'>): Promise<Doc<'discountCodes'>[]> {
  return ctx.db
    .query('discountCodes')
    .withIndex('by_persona_active', (q) => q.eq('personaId', personaId).eq('active', true))
    .collect()
}

/** The code an episode's descriptions carry when they go out: its own active code, else the persona's, else none. */
export async function activeDiscountCodeFor(
  ctx: Reader,
  personaId: Id<'personas'>,
  episodeId?: Id<'episodes'>
): Promise<Doc<'discountCodes'> | null> {
  const active = await activeDiscountCodes(ctx, personaId)
  if (episodeId) {
    const bound = active.find((code) => code.episodeId === episodeId)
    if (bound) return bound
  }
  return active.find((code) => code.episodeId === undefined) ?? null
}

/** An episode whose publications are live or withdrawn keeps the descriptions they went out with; a code bound to it would never reach them. */
const CODE_BINDABLE_STATUSES = new Set<Doc<'episodes'>['status']>([
  'idea',
  'scripted',
  'waiting_on_you',
  'recording',
  'rendered',
  'scheduled',
  'failed',
])

/**
 * Hands a code to a persona, or to one of its episodes. A Polar discount is
 * one per organization, so a code string is active in one scope at a time:
 * the previous code of exactly that scope retires, a code active elsewhere
 * refuses. Every publication in the scope that goes out from now on carries
 * it, so the promise the persona makes in chat is true from the next
 * publication on.
 */
export async function giveDiscountCode(
  ctx: MutationCtx,
  args: { personaId: Id<'personas'>; code: string; offer: string; episodeId?: Id<'episodes'> }
): Promise<Id<'discountCodes'>> {
  const code = normalizeDiscountCode(args.code)
  if (!code) throw refusal('A code is 3 to 24 letters or digits.')
  const offer = args.offer.trim()
  if (!offer) throw refusal('Say what the code offers, such as "20% off Pro for 3 months".')
  const persona = await ctx.db.get(args.personaId)
  if (!persona) throw new Error(`persona ${args.personaId} not found`)
  const episode = args.episodeId ? await ctx.db.get(args.episodeId) : null
  if (args.episodeId && !episode) throw new Error(`episode ${args.episodeId} not found`)
  if (episode && episode.personaId !== persona._id) throw new Error(`episode ${episode._id} belongs to another persona`)
  if (episode && !CODE_BINDABLE_STATUSES.has(episode.status)) {
    throw refusal(`"${episode.title}" is at "${EPISODE_STATUS_LABELS[episode.status]}"; its descriptions cannot change any more.`)
  }

  const elsewhere = (
    await ctx.db
      .query('discountCodes')
      .withIndex('by_code', (q) => q.eq('code', code))
      .collect()
  ).find((row) => row.active && (row.personaId !== persona._id || row.episodeId !== args.episodeId))
  if (elsewhere) throw refusal(await inUseMessage(ctx, persona, elsewhere))

  const now = Date.now()
  // Exact scope: the same episode, or persona-wide when neither has one.
  const previous = (await activeDiscountCodes(ctx, persona._id)).filter((candidate) => candidate.episodeId === args.episodeId)
  for (const candidate of previous) await ctx.db.patch(candidate._id, { active: false, retiredAt: now })

  const discountCodeId = await ctx.db.insert('discountCodes', {
    personaId: persona._id,
    episodeId: args.episodeId,
    code,
    offer,
    active: true,
    redemptions: 0,
    createdAt: now,
  })
  await ctx.db.insert('messages', {
    personaId: persona._id,
    author: 'persona',
    text: episode
      ? `Code ${code} (${offer}) goes into the descriptions of "${episode.title}".`
      : `Code ${code} (${offer}) goes into every description from the next publication on.`,
    createdAt: now,
  })
  return discountCodeId
}

async function inUseMessage(ctx: Reader, persona: Doc<'personas'>, row: Doc<'discountCodes'>): Promise<string> {
  if (row.personaId !== persona._id) {
    const owner = await ctx.db.get(row.personaId)
    if (!owner) throw new Error(`persona ${row.personaId} of code ${row._id} not found`)
    return `${row.code} is already ${owner.name}'s code; retire it first.`
  }
  if (row.episodeId === undefined) return `${row.code} is already ${persona.name}'s persona-wide code; retire it first.`
  const bound = await ctx.db.get(row.episodeId)
  if (!bound) throw new Error(`episode ${row.episodeId} of code ${row._id} not found`)
  return `${row.code} is already bound to "${bound.title}"; retire it first.`
}

/** Retiring a code keeps it out of every description sent from now on; a live description keeps it, and Polar still accepts it. */
export async function retireDiscountCode(ctx: MutationCtx, discountCodeId: Id<'discountCodes'>): Promise<void> {
  const code = await ctx.db.get(discountCodeId)
  if (!code) throw new Error(`discount code ${discountCodeId} not found`)
  if (!code.active) return
  await ctx.db.patch(discountCodeId, { active: false, retiredAt: Date.now() })
}

/**
 * Which row of a code owns a redemption: the latest row given before the
 * order. The same code string can be handed out again after a retirement,
 * and old videos keep carrying it, so an order after the last retirement
 * still belongs to the last row rather than to nobody.
 */
export function redemptionOwner<Row extends { createdAt: number }>(rows: readonly Row[], at: number): Row | undefined {
  let owner: Row | undefined
  for (const row of rows) {
    if (row.createdAt > at) continue
    if (!owner || row.createdAt > owner.createdAt) owner = row
  }
  return owner
}
