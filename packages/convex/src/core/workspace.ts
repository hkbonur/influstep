import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { refusal } from '../lib/errors'

/**
 * The one workspace today. Every handler that needs the sponsor, the app URL
 * or the value per paid conversion reads it through here, so a missing
 * workspace fails with one message everywhere.
 */

type Reader = { db: QueryCtx['db'] }

/** The single workspace, for handlers that start from nothing (the Providers page, creating a persona). */
export async function requireWorkspace(ctx: Reader): Promise<Doc<'workspaces'>> {
  const workspace = await ctx.db.query('workspaces').first()
  if (!workspace) throw refusal('There is no workspace yet. Run the seed first.')
  return workspace
}

/** The workspace a persona belongs to. */
export async function workspaceOf(ctx: Reader, persona: Doc<'personas'>): Promise<Doc<'workspaces'>> {
  const workspace = await ctx.db.get(persona.workspaceId)
  if (!workspace) throw new Error(`workspace ${persona.workspaceId} of persona ${persona._id} not found`)
  return workspace
}

/**
 * The workspace a first run starts from, when nobody ran the seed: Formstep
 * as the sponsor, the studio's own origin for links, and the value per paid
 * conversion the operator changes on the Providers page.
 */
export const FIRST_WORKSPACE = {
  name: 'Formstep',
  sponsorName: 'Formstep',
  sponsorUrl: 'https://formstep.io',
  // Formstep's own app: a demo beat records it, so the runner's browser must be signed in there first.
  signInRequiredHosts: ['app.formstep.io'],
  valuePerPaid: 29,
  currency: 'EUR',
} as const

/** The single workspace, made from FIRST_WORKSPACE on the first run. */
export async function ensureWorkspace(ctx: MutationCtx, appUrl: string): Promise<Doc<'workspaces'>> {
  const existing = await ctx.db.query('workspaces').first()
  if (existing) return existing
  if (!URL.canParse(appUrl)) throw new Error(`the studio's origin ${appUrl} is no URL`)
  const workspaceId = await ctx.db.insert('workspaces', {
    ...FIRST_WORKSPACE,
    signInRequiredHosts: [...FIRST_WORKSPACE.signInRequiredHosts],
    appUrl: appUrl.replace(/\/+$/, ''),
    signedInHosts: [],
  })
  const workspace = await ctx.db.get(workspaceId)
  if (!workspace) throw new Error('workspace vanished')
  return workspace
}
