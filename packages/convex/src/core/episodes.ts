import {
  PLATFORM_ASPECT,
  canTransition,
  makeSlug,
  slugify,
  type AspectRatio,
  type Platform,
  type ProducePayload,
  type ProduceResult,
  type PublishResult,
  type Shot,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { applyEvent } from '../internal/data'
import { enqueueJob } from '../jobs/queue'
import type { ScriptDraft } from '../providers/llm'
import { buildDescription } from './attribution'
import { instantAt } from './dates'

/**
 * Episode rules that touch several tables at once: approval and its sign-in
 * checks, what happens when the runner finishes a render, how publications
 * and tracked links are created, and what a live publication does to the
 * episode. Operator mutations and agent actions both call these.
 */

export interface PlannedEpisodeInput {
  personaId: Id<'personas'>
  plannedFor: string
  concept: string
  pillar: string
  sponsorSegment: Doc<'episodes'>['sponsorSegment']
  signalIds: Id<'signals'>[]
  experimentId?: Id<'experiments'>
  variantKey?: string
}

export async function createIdea(ctx: MutationCtx, persona: Doc<'personas'>, input: PlannedEpisodeInput): Promise<Id<'episodes'>> {
  const now = Date.now()
  const episodeId = await ctx.db.insert('episodes', {
    personaId: input.personaId,
    slug: `${slugify(input.concept) || 'episode'}-${makeSlug(4)}`,
    status: 'idea',
    concept: input.concept,
    title: input.concept,
    hook: '',
    script: { hook: '', body: '', sponsor: '', cta: '' },
    sponsorSegment: input.sponsorSegment,
    shots: [],
    renders: [],
    plannedFor: input.plannedFor,
    scheduledAt: instantAt(input.plannedFor, persona.publishHour, persona.timezone),
    experimentId: input.experimentId,
    variantKey: input.variantKey,
    signalIds: input.signalIds,
    pillar: input.pillar,
    createdAt: now,
    updatedAt: now,
  })
  for (const signalId of input.signalIds) await ctx.db.patch(signalId, { status: 'used' })
  await enqueueJob(ctx, { kind: 'write_script', payload: { episodeId }, personaId: input.personaId, episodeId })
  return episodeId
}

/** The writer's draft becomes the episode's script and shot list. */
export function shotsFromDraft(draft: ScriptDraft, sponsorName: string): Shot[] {
  return draft.shotPlan.map((shot, index) => {
    const id = `shot-${index + 1}`
    if (shot.tool.toLowerCase() === sponsorName.toLowerCase()) {
      return {
        kind: 'screen',
        id,
        title: shot.title,
        voiceover: shot.voiceover,
        recipe: [
          { step: 'goto', url: shot.url },
          { step: 'wait', ms: 1500 },
          { step: 'scroll', y: 400 },
          { step: 'wait', ms: 1500 },
        ],
      }
    }
    return {
      kind: 'screen',
      id,
      title: shot.title,
      voiceover: shot.voiceover,
      recipe: [
        { step: 'goto', url: shot.url },
        { step: 'wait', ms: 2000 },
      ],
    }
  })
}

/** Tools a screen shot opens, by hostname, so approval can check sign-ins. */
export function toolsNeededBy(shots: Shot[]): string[] {
  const hosts = new Set<string>()
  for (const shot of shots) {
    if (shot.kind !== 'screen') continue
    for (const step of shot.recipe) {
      if (step.step !== 'goto') continue
      try {
        hosts.add(new URL(step.url).host)
      } catch {
        // A relative or malformed URL has no host to sign in to; the runner reports it.
      }
    }
  }
  return [...hosts]
}

/**
 * Approval: either the producer can start, or a sign-in is missing and the
 * episode waits on the operator with a checklist item that opens the runner's
 * browser at the tool.
 */
export async function approveEpisode(ctx: MutationCtx, episodeId: Id<'episodes'>): Promise<void> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  const persona = await ctx.db.get(episode.personaId)
  if (!persona) throw new Error(`persona ${episode.personaId} not found`)
  const workspace = await ctx.db.get(persona.workspaceId)
  if (!workspace) throw new Error(`workspace ${persona.workspaceId} not found`)

  await ctx.db.patch(episodeId, { approvedAt: Date.now() })
  const missing = toolsNeededBy(episode.shots).filter(
    (host) => workspace.signInRequiredHosts.includes(host) && !workspace.signedInHosts.includes(host)
  )
  if (missing.length > 0) {
    await applyEvent(ctx, episodeId, { type: 'blocked' })
    for (const host of missing) {
      const existing = await ctx.db
        .query('checklistItems')
        .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
        .filter((q) => q.eq(q.field('status'), 'open'))
        .collect()
      if (existing.some((item) => item.action?.kind === 'open_browser' && item.action.url.includes(host))) continue
      await ctx.db.insert('checklistItems', {
        personaId: persona._id,
        episodeId,
        title: `Sign in to ${host} in the runner's browser`,
        why: `"${episode.title}" records a screen on ${host}. The producer uses your signed-in session and never stores the password.`,
        status: 'open',
        action: { kind: 'open_browser', url: `https://${host}` },
        createdAt: Date.now(),
      })
    }
    return
  }
  await startProduction(ctx, episode, persona)
}

export async function startProduction(ctx: MutationCtx, episode: Doc<'episodes'>, persona: Doc<'personas'>): Promise<void> {
  const aspects = [...new Set(persona.platforms.map((platform) => PLATFORM_ASPECT[platform]))] as AspectRatio[]
  const payload: ProducePayload = {
    episodeId: episode._id,
    personaHandle: persona.handle,
    voiceId: persona.voiceId,
    shots: episode.shots,
    aspects,
  }
  await enqueueJob(ctx, { kind: 'produce', payload, personaId: persona._id, episodeId: episode._id })
}

/** The runner rendered the episode: store renders, then queue one publication per platform. */
export async function completeProduction(ctx: MutationCtx, episodeId: Id<'episodes'>, result: ProduceResult): Promise<void> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  const persona = await ctx.db.get(episode.personaId)
  if (!persona) throw new Error(`persona ${episode.personaId} not found`)
  const workspace = await ctx.db.get(persona.workspaceId)
  if (!workspace) throw new Error(`workspace ${persona.workspaceId} not found`)

  await ctx.db.patch(episodeId, {
    renders: result.renders.map((render) => ({ ...render, storageId: render.storageId as Id<'_storage'> })),
    updatedAt: Date.now(),
  })
  await applyEvent(ctx, episodeId, { type: 'produced' })

  for (const platform of persona.platforms) {
    const existing = await ctx.db
      .query('publications')
      .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
      .filter((q) => q.eq(q.field('platform'), platform))
      .first()
    if (existing) continue
    const linkId = await createTrackedLink(ctx, { persona, episode, platform, target: workspace.sponsorUrl })
    const link = await ctx.db.get(linkId)
    if (!link) throw new Error('link vanished')
    await ctx.db.insert('publications', {
      episodeId,
      personaId: persona._id,
      platform,
      status: 'queued',
      title: episode.title,
      description: buildDescription({
        concept: episode.concept,
        sponsorSegment: episode.sponsorSegment,
        sponsorName: workspace.sponsorName,
        trackedUrl: `${workspace.appUrl}/go/${link.slug}`,
        platform,
      }),
      linkId,
      scheduledAt: episode.scheduledAt,
      mock: result.renders.some((render) => render.mock),
    })
  }
  await applyEvent(ctx, episodeId, { type: 'scheduled' })
}

export async function createTrackedLink(
  ctx: MutationCtx,
  args: { persona: Doc<'personas'>; episode?: Doc<'episodes'>; platform?: Platform; target: string }
): Promise<Id<'links'>> {
  let slug = makeSlug(7)
  while (
    await ctx.db
      .query('links')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first()
  )
    slug = makeSlug(7)
  return ctx.db.insert('links', {
    slug,
    personaId: args.persona._id,
    episodeId: args.episode?._id,
    platform: args.platform,
    target: args.target,
    clicks: 0,
    createdAt: Date.now(),
  })
}

/** A publication went live. Once every platform is live the episode is published. */
export async function completePublication(ctx: MutationCtx, publicationId: Id<'publications'>, result: PublishResult): Promise<void> {
  const publication = await ctx.db.get(publicationId)
  if (!publication) throw new Error(`publication ${publicationId} not found`)
  await ctx.db.patch(publicationId, {
    status: 'live',
    externalId: result.externalId,
    url: result.url,
    publishedAt: result.publishedAt,
    mock: result.mock,
    error: undefined,
  })
  const siblings = await ctx.db
    .query('publications')
    .withIndex('by_episode', (q) => q.eq('episodeId', publication.episodeId))
    .collect()
  if (siblings.every((sibling) => sibling._id === publicationId || sibling.status === 'live')) {
    await ctx.db.patch(publication.episodeId, { publishedAt: result.publishedAt })
    await applyEvent(ctx, publication.episodeId, { type: 'published' })
  }
}

export async function failPublication(ctx: MutationCtx, publicationId: Id<'publications'>, error: string): Promise<void> {
  const publication = await ctx.db.get(publicationId)
  if (!publication) throw new Error(`publication ${publicationId} not found`)
  await ctx.db.patch(publicationId, { status: 'failed', error })
  // A sibling may already have failed the episode; the second error is on the publication row.
  const episode = await ctx.db.get(publication.episodeId)
  if (!episode || !canTransition(episode.status, 'failed')) return
  await applyEvent(ctx, publication.episodeId, { type: 'failed', error: `${publication.platform}: ${error}` })
}
