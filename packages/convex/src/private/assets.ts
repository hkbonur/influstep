import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { addUploadedAsset, assetsView, removeAsset, updateAsset, type UploadOutcome } from '../core/assets'

/** What the assets page reads: the persona's library, newest first, with a preview URL for each file. */
export const list = query({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) return null
    return { persona: { _id: persona._id, name: persona.name }, assets: await assetsView(ctx, persona) }
  },
})

/** Where the studio posts the file of a new asset; `add` then names it. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<string> => ctx.storage.generateUploadUrl(),
})

/**
 * The operator's uploaded file becomes an asset of the persona, with the name
 * the writer asks for it by. A refused upload is returned with its words, and
 * its file is gone (core `addUploadedAsset`).
 */
export const add = mutation({
  args: { personaId: v.id('personas'), storageId: v.id('_storage'), name: v.string(), tags: v.array(v.string()), note: v.string() },
  handler: async (ctx, args): Promise<UploadOutcome> => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    return addUploadedAsset(ctx, persona, { storageId: args.storageId, name: args.name, tags: args.tags, note: args.note, now: Date.now() })
  },
})

/** Rename an asset, or change its tags or its note. */
export const update = mutation({
  args: { assetId: v.id('assets'), name: v.string(), tags: v.array(v.string()), note: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await updateAsset(ctx, args.assetId, { name: args.name, tags: args.tags, note: args.note })
  },
})

/** Delete an asset and its file, unless a script that may still be recorded shows it. */
export const remove = mutation({
  args: { assetId: v.id('assets') },
  handler: async (ctx, args): Promise<void> => {
    await removeAsset(ctx, args.assetId)
  },
})
