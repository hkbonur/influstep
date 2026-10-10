import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

/**
 * The one workspace today. Every handler that needs the sponsor, the app URL
 * or the value per paid conversion reads it through here, so a missing
 * workspace fails with one message everywhere.
 */

type Reader = { db: QueryCtx['db'] }

/** The single workspace, for handlers that start from nothing (the Providers page, creating a persona). */
export async function requireWorkspace(ctx: Reader): Promise<Doc<'workspaces'>> {
  const workspace = await ctx.db.query('workspaces').first()
  if (!workspace) throw new Error('Run the seed first: there is no workspace')
  return workspace
}

/** The workspace a persona belongs to. */
export async function workspaceOf(ctx: Reader, persona: Doc<'personas'>): Promise<Doc<'workspaces'>> {
  const workspace = await ctx.db.get(persona.workspaceId)
  if (!workspace) throw new Error(`workspace ${persona.workspaceId} of persona ${persona._id} not found`)
  return workspace
}
