import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/**
 * Checklist items an agent opens without an episode to block. Today: what a
 * persona needs once it publishes on X (docs/plan.md, slice 4). Every X
 * account Influstep runs carries X's label for automated accounts, the same
 * posture as the AI disclosure on videos, and publishing needs the persona's
 * account connected.
 */

/** X's help page for the automated account label: the operator turns it on by hand in the account's settings. */
export const X_AUTOMATED_LABEL_URL = 'https://help.x.com/en/using-x/automated-account-labels'

/** The provider key the X publisher reads once the adapter exists. */
export const X_PROVIDER_KEY = 'X_OAUTH'

/**
 * The two X items for a persona that gained X, each opened once per persona:
 * an item already there, open or done, is not opened again, so dropping X
 * and adding it back asks for nothing the operator already did.
 */
export async function openXChecklist(ctx: MutationCtx, persona: Doc<'personas'>): Promise<void> {
  const items = [
    ...(await ctx.db
      .query('checklistItems')
      .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'open'))
      .collect()),
    ...(await ctx.db
      .query('checklistItems')
      .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'done'))
      .collect()),
  ]
  const now = Date.now()
  const hasLabelItem = items.some((item) => item.action?.kind === 'visit' && item.action.url === X_AUTOMATED_LABEL_URL)
  if (!hasLabelItem) {
    await ctx.db.insert('checklistItems', {
      personaId: persona._id,
      title: `Turn on X's automated account label for @${persona.handle}`,
      why: `X asks every account that posts through its API to say so. Turn the label on in @${persona.handle}'s settings, the same way every video carries its AI disclosure.`,
      status: 'open',
      action: { kind: 'visit', url: X_AUTOMATED_LABEL_URL },
      createdAt: now,
    })
  }
  const hasConnectItem = items.some((item) => item.action?.kind === 'set_provider_key' && item.action.key === X_PROVIDER_KEY)
  if (!hasConnectItem) {
    await ctx.db.insert('checklistItems', {
      personaId: persona._id,
      title: `Connect an X account for ${persona.name}`,
      why: `Publishing to X needs the X API keys and ${persona.name}'s account. Until then the publisher runs in mock mode and says so on every publication.`,
      status: 'open',
      action: { kind: 'set_provider_key', key: X_PROVIDER_KEY },
      createdAt: now,
    })
  }
}
