import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { enqueueJob } from '../jobs/queue'
import { refusal } from '../lib/errors'
import type { ScriptBrief } from '../providers/llm/types'
import { openXChecklist } from './checklist'
import { addDays, dayKey, weekStart } from './dates'
import { createTrackedLink } from './episodes'
import { assertFormats, platformsOf } from './formats'

/** The persona as every brief to the writer and the analyst names it. */
export function personaBriefOf(persona: Doc<'personas'>): ScriptBrief['persona'] {
  return {
    name: persona.name,
    handle: persona.handle,
    niche: persona.niche,
    audience: persona.audience,
    tone: persona.tone,
    bible: persona.bible,
    pillars: persona.pillars,
  }
}

/** A persona's settings, as the operator gives them. */
export type PersonaFields = Omit<Doc<'personas'>, '_id' | '_creationTime' | 'workspaceId' | 'paused' | 'createdAt' | 'voice' | 'strategy'>

/**
 * A new persona in the workspace: its bio link, the X checklist when it is on
 * X, and its first signal poll. The handle is the persona's on every platform
 * and its links' utm_source, so a taken one is refused.
 */
export async function createPersona(ctx: MutationCtx, workspace: Doc<'workspaces'>, fields: PersonaFields): Promise<Doc<'personas'>> {
  assertFormats(fields.formats)
  const taken = await ctx.db
    .query('personas')
    .withIndex('by_handle', (q) => q.eq('handle', fields.handle))
    .first()
  if (taken) throw refusal(`The handle ${fields.handle} is taken.`)
  const personaId = await ctx.db.insert('personas', { ...fields, workspaceId: workspace._id, paused: false, createdAt: Date.now() })
  const persona = await ctx.db.get(personaId)
  if (!persona) throw new Error('persona vanished')
  await createTrackedLink(ctx, { persona, target: workspace.sponsorUrl })
  if (platformsOf(persona).includes('x')) await openXChecklist(ctx, persona)
  await enqueueJob(ctx, { kind: 'poll_signals', payload: { personaId }, personaId })
  return persona
}

/**
 * The persona's first plan: the rest of this week and the whole of next. The
 * Monday plan covers the week after it, so a persona made mid-week would
 * otherwise wait until then for next week's episodes. The planner never
 * schedules a day already gone.
 */
export async function planFirstWeeks(ctx: MutationCtx, persona: Doc<'personas'>, now: number): Promise<Id<'jobs'>[]> {
  const thisWeek = weekStart(dayKey(now, persona.timezone))
  const jobs: Id<'jobs'>[] = []
  for (const start of [thisWeek, addDays(thisWeek, 7)]) {
    jobs.push(await enqueueJob(ctx, { kind: 'plan_week', payload: { personaId: persona._id, weekStart: start }, personaId: persona._id }))
  }
  return jobs
}
