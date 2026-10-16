import { v } from 'convex/values'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { internalAction, internalMutation } from '../_generated/server'
import { failGeneration, finishGeneration, startGeneration } from '../core/media'
import { mediaProvider } from '../providers/media'

/**
 * The producer's generate_media job (docs/plan.md, slice 15): start the
 * generation within the day's budget, ask the media provider, store the file
 * and save it as the producer's asset. A budget that is spent or a provider
 * that fails fails the job with why, and the generation with it.
 */
export const generate = internalAction({
  args: { generationId: v.string() },
  handler: async (ctx, args): Promise<{ assetId: Id<'assets'> }> => {
    const generationId = args.generationId as Id<'generations'>
    const started = await ctx.runMutation(internal.internal.media.start, { generationId })
    if (started.status === 'refused') throw new Error(started.message)
    try {
      const result = await mediaProvider().generate(started.request)
      const storageId = await ctx.storage.store(new Blob([result.bytes], { type: result.contentType }))
      const assetId = await ctx.runMutation(internal.internal.media.finish, {
        generationId,
        storageId,
        contentType: result.contentType,
        model: result.model,
        mock: result.mock,
      })
      return { assetId }
    } catch (error) {
      await ctx.runMutation(internal.internal.media.fail, { generationId, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },
})

export const start = internalMutation({
  args: { generationId: v.id('generations') },
  handler: async (ctx, args) => startGeneration(ctx, args.generationId, Date.now()),
})

export const finish = internalMutation({
  args: { generationId: v.id('generations'), storageId: v.id('_storage'), contentType: v.string(), model: v.string(), mock: v.boolean() },
  handler: async (ctx, args): Promise<Id<'assets'>> =>
    finishGeneration(
      ctx,
      args.generationId,
      { storageId: args.storageId, contentType: args.contentType, model: args.model, mock: args.mock },
      Date.now()
    ),
})

export const fail = internalMutation({
  args: { generationId: v.id('generations'), error: v.string() },
  handler: async (ctx, args) => failGeneration(ctx, args.generationId, args.error, Date.now()),
})
