import { AGENT_ROLES, isChatTask, type AgentRole, type JobKind, type JobRuntime, type JobStatus } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import { query, type QueryCtx } from '../_generated/server'
import { latestRunner } from '../core/jobs'

/**
 * The Agents page (docs/plan.md, slice 7): five workspace workers, one per
 * role, each serving every persona from its own queue. A row per role shows
 * what it is on now, what waits next, and what it finished last.
 */

/** How many queued and how many finished jobs a role's row lists. */
const ROW_JOBS = 5

export interface AgentJobRow {
  _id: Id<'jobs'>
  kind: JobKind
  status: JobStatus
  runsOn: JobRuntime
  persona: { _id: Id<'personas'>; name: string; handle: string; color: Doc<'personas'>['color'] } | null
  episode: { _id: Id<'episodes'>; title: string } | null
  /** What the job was asked to do in words: a task's topic, else the chat message that asked for it. */
  brief: string | null
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
}

export interface AgentRow {
  role: AgentRole
  running: AgentJobRow[]
  queued: { count: number; next: AgentJobRow[] }
  recent: AgentJobRow[]
}

export interface AgentBoard {
  /** One row per role, in AGENT_ROLES order. */
  roles: AgentRow[]
  /**
   * When the runner process was last heard from, or null when none ever
   * checked in. Runner jobs of the producer and the publisher wait for it.
   * The studio judges liveness against its own clock (shared `runnerAlive`):
   * this query re-runs only when a row changes, and a runner that stops
   * beating changes nothing.
   */
  runnerLastSeenAt: number | null
}

export const board = query({
  args: {},
  handler: async (ctx): Promise<AgentBoard> => {
    const rowsOf = jobRows(ctx)
    const roles: AgentRow[] = []
    for (const role of AGENT_ROLES) {
      const running = await jobsOf(ctx, role, 'running').collect()
      const queued = await jobsOf(ctx, role, 'queued').collect()
      // The newest by creation of each finished status, merged by when they finished.
      const done = await jobsOf(ctx, role, 'done').order('desc').take(ROW_JOBS)
      const failed = await jobsOf(ctx, role, 'failed').order('desc').take(ROW_JOBS)
      const recent = [...done, ...failed].sort((a, b) => finishedAtOf(b) - finishedAtOf(a)).slice(0, ROW_JOBS)
      roles.push({
        role,
        running: await rowsOf(running.sort((a, b) => a.createdAt - b.createdAt)),
        queued: { count: queued.length, next: await rowsOf(queued.sort((a, b) => a.createdAt - b.createdAt).slice(0, ROW_JOBS)) },
        recent: await rowsOf(recent),
      })
    }
    const runner = await latestRunner(ctx)
    return { roles, runnerLastSeenAt: runner === null ? null : runner.lastSeenAt }
  },
})

function jobsOf(ctx: QueryCtx, role: AgentRole, status: JobStatus) {
  return ctx.db.query('jobs').withIndex('by_role_status', (q) => q.eq('role', role).eq('status', status))
}

/** A finished job always has finishedAt (jobs/queue.ts sets it on done and on failed); one without it is a bug. */
function finishedAtOf(job: Doc<'jobs'>): number {
  if (job.finishedAt === undefined) throw new Error(`job ${job._id} is ${job.status} without finishedAt`)
  return job.finishedAt
}

/**
 * Builds rows, reading each persona and episode once however many jobs name
 * it. Personas, episodes and messages are never deleted outside a full reset,
 * so a job that names a missing one is a bug.
 */
function jobRows(ctx: QueryCtx): (jobs: Doc<'jobs'>[]) => Promise<AgentJobRow[]> {
  const personas = new Map<Id<'personas'>, Doc<'personas'>>()
  const episodes = new Map<Id<'episodes'>, Doc<'episodes'>>()

  async function personaOf(personaId: Id<'personas'>): Promise<Doc<'personas'>> {
    const cached = personas.get(personaId)
    if (cached) return cached
    const persona = await ctx.db.get(personaId)
    if (!persona) throw new Error(`persona ${personaId} not found`)
    personas.set(personaId, persona)
    return persona
  }

  async function episodeOf(episodeId: Id<'episodes'>): Promise<Doc<'episodes'>> {
    const cached = episodes.get(episodeId)
    if (cached) return cached
    const episode = await ctx.db.get(episodeId)
    if (!episode) throw new Error(`episode ${episodeId} not found`)
    episodes.set(episodeId, episode)
    return episode
  }

  /** A chat task's topic, or the operator's message when it named none. Every other job has no brief. */
  async function briefOf(job: Doc<'jobs'>): Promise<string | null> {
    if (!isChatTask(job.kind)) return null
    const topic = topicOf(job.payload)
    if (topic !== null) return topic
    if (job.messageId === undefined) return null
    const message = await ctx.db.get(job.messageId)
    if (!message) throw new Error(`message ${job.messageId} of job ${job._id} not found`)
    return message.text
  }

  async function rowOf(job: Doc<'jobs'>): Promise<AgentJobRow> {
    const persona = job.personaId === undefined ? null : await personaOf(job.personaId)
    const episode = job.episodeId === undefined ? null : await episodeOf(job.episodeId)
    return {
      _id: job._id,
      kind: job.kind,
      status: job.status,
      runsOn: job.runsOn,
      persona: persona === null ? null : { _id: persona._id, name: persona.name, handle: persona.handle, color: persona.color },
      episode: episode === null ? null : { _id: episode._id, title: episode.title },
      brief: await briefOf(job),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
    }
  }

  return async (jobs) => {
    const rows: AgentJobRow[] = []
    for (const job of jobs) rows.push(await rowOf(job))
    return rows
  }
}

/** The payload is stored as v.any(); a chat task's topic is narrowed here. Null when the message named none. */
function topicOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) throw new Error('job payload is not an object')
  if (!('topic' in payload) || payload.topic === undefined) return null
  if (typeof payload.topic !== 'string') throw new Error('a chat task topic is not a string')
  const topic = payload.topic.trim()
  return topic === '' ? null : topic
}
