import {
  DEFAULT_FORMATS,
  JOB_KINDS,
  type EpisodeKind,
  type EpisodeStatus,
  type JobKind,
  type JobStatus,
  type Platform,
  type SponsorSegment,
} from '@influstep/shared'
import type { Doc, Id } from '../src/_generated/dataModel'
import type { MutationCtx } from '../src/_generated/server'
import { instantAt } from '../src/core/dates'

/**
 * Rows for tests of the core rules that need a database but not the whole
 * seed: one workspace, one persona, and episodes, publications and jobs at
 * exactly the status a test names. Every row is inserted as it is, so no
 * rule runs and nothing is scheduled.
 */

export const TIMEZONE = 'Europe/Oslo'

/** The local hour every fixture video goes out at (YouTube's default). */
export const VIDEO_HOUR = DEFAULT_FORMATS.youtube.publishHour

export async function insertPersona(ctx: MutationCtx, fields: { name?: string; handle?: string } = {}): Promise<Doc<'personas'>> {
  const workspaceId = await ctx.db.insert('workspaces', {
    name: 'Formstep',
    sponsorName: 'Formstep',
    sponsorUrl: 'https://formstep.io',
    appUrl: 'http://localhost:3300',
    signInRequiredHosts: [],
    signedInHosts: [],
    valuePerPaid: 29,
    currency: 'EUR',
  })
  const personaId = await ctx.db.insert('personas', {
    workspaceId,
    name: fields.name ?? 'Ada Automates',
    color: 'teal',
    handle: fields.handle ?? 'ada.automates',
    niche: 'n8n',
    tone: 'calm',
    bio: '',
    bible: '',
    pillars: ['n8n tutorials'],
    formats: [
      { platform: 'youtube', ...DEFAULT_FORMATS.youtube },
      { platform: 'x', ...DEFAULT_FORMATS.x },
    ],
    voiceId: 'mock-ada',
    sponsorDial: 0.4,
    sponsorRampEpisodes: 10,
    episodesPerWeek: 5,
    autoApprove: false,
    autoPublish: false,
    paused: false,
    timezone: TIMEZONE,
    createdAt: Date.now(),
  })
  const persona = await ctx.db.get(personaId)
  if (!persona) throw new Error('persona vanished')
  return persona
}

export async function insertEpisode(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  fields: { status: EpisodeStatus; plannedFor: string; kind?: EpisodeKind; concept?: string; pillar?: string }
): Promise<Doc<'episodes'>> {
  const concept = fields.concept ?? `Episode on ${fields.plannedFor}`
  const kind = fields.kind ?? 'video'
  const platforms: Platform[] = kind === 'video' ? ['youtube', 'x'] : ['x']
  const episodeId = await ctx.db.insert('episodes', {
    personaId: persona._id,
    slug: `${fields.plannedFor}-${concept.length}-${Math.random().toString(36).slice(2, 6)}`,
    kind,
    ...(kind === 'video' ? {} : { intent: 'inform' as const, length: kind === 'thread' ? ('long' as const) : ('short' as const) }),
    status: fields.status,
    concept,
    title: concept,
    hook: '',
    sponsorSegment: 'none',
    platforms,
    shots: [],
    renders: [],
    plannedFor: fields.plannedFor,
    scheduledAt: instantAt(fields.plannedFor, VIDEO_HOUR, TIMEZONE),
    signalIds: [],
    pillar: fields.pillar,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error('episode vanished')
  return episode
}

export async function insertPublication(
  ctx: MutationCtx,
  episode: Doc<'episodes'>,
  fields: { platform: Platform; status: Doc<'publications'>['status'] }
): Promise<Doc<'publications'>> {
  const linkId = await ctx.db.insert('links', {
    slug: Math.random().toString(36).slice(2, 9),
    personaId: episode.personaId,
    episodeId: episode._id,
    platform: fields.platform,
    target: 'https://formstep.io',
    clicks: 0,
    createdAt: Date.now(),
  })
  const publicationId = await ctx.db.insert('publications', {
    episodeId: episode._id,
    personaId: episode.personaId,
    platform: fields.platform,
    aspect: '16:9',
    status: fields.status,
    title: episode.title,
    body: 'A description.',
    linkId,
    scheduledAt: episode.scheduledAt,
    mock: true,
  })
  const publication = await ctx.db.get(publicationId)
  if (!publication) throw new Error('publication vanished')
  return publication
}

/** A job row at the status given, for the episode; nothing runs it. */
export async function insertJob(
  ctx: MutationCtx,
  episode: Doc<'episodes'>,
  fields: { kind: JobKind; status: JobStatus }
): Promise<Doc<'jobs'>> {
  const now = Date.now()
  const meta = JOB_KINDS[fields.kind]
  const finished = fields.status === 'done' || fields.status === 'failed'
  const jobId = await ctx.db.insert('jobs', {
    kind: fields.kind,
    role: meta.role,
    runsOn: meta.runsOn,
    status: fields.status,
    personaId: episode.personaId,
    episodeId: episode._id,
    payload: { episodeId: episode._id },
    attempts: fields.status === 'queued' ? 0 : 1,
    createdAt: now,
    startedAt: fields.status === 'queued' ? undefined : now,
    finishedAt: finished ? now : undefined,
  })
  const job = await ctx.db.get(jobId)
  if (!job) throw new Error('job vanished')
  return job
}

/**
 * A video that went out and was measured on one platform: a live
 * publication, its tracked link with `clicks`, and one snapshot with `views`
 * and `follows` three days after it went live.
 */
export async function insertMeasuredVideo(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  fields: {
    publishedAt: number
    views: number
    clicks: number
    follows?: number
    pillar?: string
    platform?: Platform
    experimentId?: Id<'experiments'>
    variantKey?: string
    sponsorSegment?: SponsorSegment
    status?: 'measured' | 'published'
  }
): Promise<Doc<'episodes'>> {
  const platform = fields.platform ?? 'youtube'
  const plannedFor = new Date(fields.publishedAt).toISOString().slice(0, 10)
  const episodeId = await ctx.db.insert('episodes', {
    personaId: persona._id,
    slug: `${plannedFor}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'video',
    status: fields.status ?? 'measured',
    concept: `Video of ${plannedFor}`,
    title: `Video of ${plannedFor}`,
    hook: '',
    sponsorSegment: fields.sponsorSegment ?? 'none',
    platforms: [platform],
    shots: [],
    renders: [],
    plannedFor,
    scheduledAt: fields.publishedAt,
    experimentId: fields.experimentId,
    variantKey: fields.variantKey,
    signalIds: [],
    pillar: fields.pillar,
    publishedAt: fields.publishedAt,
    measuredAt: fields.publishedAt + 72 * 3_600_000,
    createdAt: fields.publishedAt,
    updatedAt: fields.publishedAt,
  })
  const linkId = await ctx.db.insert('links', {
    slug: Math.random().toString(36).slice(2, 9),
    personaId: persona._id,
    episodeId,
    platform,
    target: 'https://formstep.io',
    clicks: fields.clicks,
    createdAt: fields.publishedAt,
  })
  const publicationId = await ctx.db.insert('publications', {
    episodeId,
    personaId: persona._id,
    platform,
    aspect: '16:9',
    status: 'live',
    title: `Video of ${plannedFor}`,
    linkId,
    scheduledAt: fields.publishedAt,
    publishedAt: fields.publishedAt,
    mock: true,
  })
  await ctx.db.insert('metricSnapshots', {
    personaId: persona._id,
    episodeId,
    publicationId,
    platform,
    takenAt: fields.publishedAt + 72 * 3_600_000,
    counts: {
      views: fields.views,
      watchRate: 0.4,
      follows: fields.follows ?? 0,
      likes: 0,
      comments: 0,
      clicks: fields.clicks,
      signups: 0,
      paid: 0,
    },
    mock: true,
  })
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error('episode vanished')
  return episode
}
