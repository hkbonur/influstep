import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { mutation, query } from '../_generated/server'
import { enqueueJob } from '../jobs/queue'
import { refusal } from '../lib/errors'

export const list = query({
  args: {},
  handler: async (ctx) => {
    const open = await ctx.db
      .query('checklistItems')
      .withIndex('by_status', (q) => q.eq('status', 'open'))
      .collect()
    const done = await ctx.db
      .query('checklistItems')
      .withIndex('by_status', (q) => q.eq('status', 'done'))
      .order('desc')
      .take(10)
    const out = []
    for (const item of [...open, ...done]) {
      const persona = await ctx.db.get(item.personaId)
      const episode = item.episodeId ? await ctx.db.get(item.episodeId) : null
      out.push({ ...item, personaName: persona?.name ?? '', personaHandle: persona?.handle ?? '', episodeTitle: episode?.title ?? null })
    }
    return out.sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === 'open' ? -1 : 1))
  },
})

/** Done: the host counts as signed in, and the episode the item blocked resumes. */
export const complete = mutation({
  args: { itemId: v.id('checklistItems') },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId)
    if (!item) throw new Error('checklist item not found')
    if (item.status === 'done') return
    const now = Date.now()
    await ctx.db.patch(item._id, { status: 'done', doneAt: now })
    const episodeIds = item.episodeId ? [item.episodeId] : []
    if (item.action?.kind === 'open_browser') {
      const persona = await ctx.db.get(item.personaId)
      const workspace = persona ? await ctx.db.get(persona.workspaceId) : null
      const host = new URL(item.action.url).host
      if (workspace && !workspace.signedInHosts.includes(host))
        await ctx.db.patch(workspace._id, { signedInHosts: [...workspace.signedInHosts, host] })
      // One sign-in serves every persona: the other items for the same host are done too.
      const open = await ctx.db
        .query('checklistItems')
        .withIndex('by_status', (q) => q.eq('status', 'open'))
        .collect()
      for (const other of open) {
        if (other.action?.kind !== 'open_browser' || new URL(other.action.url).host !== host) continue
        await ctx.db.patch(other._id, { status: 'done', doneAt: now })
        if (other.episodeId) episodeIds.push(other.episodeId)
      }
    }
    for (const episodeId of episodeIds) await ctx.runMutation(internal.internal.runner.resumeBlockedEpisode, { episodeId })
  },
})

/** The item's button: queue what the runner can do for it. */
export const runAction = mutation({
  args: { itemId: v.id('checklistItems') },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId)
    if (!item) throw new Error('checklist item not found')
    if (!item.action) throw refusal('This item has no action.')
    if (item.action.kind === 'visit') throw refusal('This page opens in your own browser; the runner has nothing to do for it.')
    if (item.action.kind === 'set_provider_key') throw refusal(`${item.action.key} is set on the Providers page, not by the runner.`)
    return enqueueJob(ctx, {
      kind: 'open_browser',
      payload: { url: item.action.url, checklistItemId: item._id },
      personaId: item.personaId,
      episodeId: item.episodeId,
    })
  },
})
