import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireWorkspace } from '../core/workspace'
import { refusal } from '../lib/errors'

/**
 * The operator's workspace: who the sponsor is, where tracked links go, and
 * what one paid conversion is worth so the report can put a value on an
 * episode. One workspace today; the seed creates it.
 */

const CURRENCY_PATTERN = /^[A-Z]{3}$/

export const get = query({
  args: {},
  handler: async (ctx) => requireWorkspace(ctx),
})

export const update = mutation({
  args: {
    sponsorName: v.string(),
    sponsorUrl: v.string(),
    appUrl: v.string(),
    valuePerPaid: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx)
    const sponsorName = args.sponsorName.trim()
    if (!sponsorName) throw refusal('The sponsor needs a name.')
    if (!(args.valuePerPaid >= 0)) throw refusal('The value per paid conversion is 0 or more.')
    if (!CURRENCY_PATTERN.test(args.currency)) throw new Error('a currency is three upper-case letters, such as EUR')
    await ctx.db.patch(workspace._id, {
      sponsorName,
      sponsorUrl: fullUrl(args.sponsorUrl, 'sponsor URL'),
      appUrl: fullUrl(args.appUrl, 'app URL').replace(/\/+$/, ''),
      valuePerPaid: args.valuePerPaid,
      currency: args.currency,
    })
  },
})

/** Tracked links are built from these, so a bad one would break at click time; refuse it here instead. */
function fullUrl(raw: string, label: string): string {
  const value = raw.trim()
  try {
    new URL(value)
  } catch {
    throw refusal(`The ${label} must be a full URL, such as https://formstep.io.`)
  }
  return value
}
