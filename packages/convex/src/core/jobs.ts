import { JOB_RUNTIMES, type JobStatus } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

type Reader = { db: QueryCtx['db'] }

/** The runner process heard from last, or null when none ever checked in. One row per runner name, so the table stays small. */
export async function latestRunner(ctx: Reader): Promise<Doc<'runners'> | null> {
  const runners = await ctx.db.query('runners').collect()
  const [latest] = runners.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  return latest ?? null
}

/** A job in one of these statuses means one of the persona's agents is at work. */
const ACTIVE_JOB_STATUSES = ['queued', 'running'] as const satisfies readonly JobStatus[]

/**
 * The personas with a job queued or running. The roster and the persona page
 * both read it here, so the sidebar and the page header never disagree. It
 * goes through the runtime and status index, because the jobs table keeps
 * every finished job forever and only the active ones are few.
 */
export async function workingPersonaIds(ctx: Reader): Promise<Set<Id<'personas'>>> {
  const ids = new Set<Id<'personas'>>()
  for (const runtime of JOB_RUNTIMES) {
    for (const status of ACTIVE_JOB_STATUSES) {
      const jobs = await ctx.db
        .query('jobs')
        .withIndex('by_runtime_status', (q) => q.eq('runsOn', runtime).eq('status', status))
        .collect()
      for (const job of jobs) {
        // A job may belong to no persona; it keeps nobody busy.
        if (job.personaId === undefined) continue
        ids.add(job.personaId)
      }
    }
  }
  return ids
}
