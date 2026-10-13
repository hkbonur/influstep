import {
  EPISODE_STATUS_LABELS,
  PLATFORM_LABELS,
  X_IMAGE_ASPECT,
  canTransition,
  formatAspects,
  isPost,
  makeSlug,
  platformsOpen,
  resolveEpisodeFormat,
  slugify,
  type Delivery,
  type EpisodeFormat,
  type Platform,
  type PostIntent,
  type PostKind,
  type PostLength,
  type ProducePayload,
  type ProduceResult,
  type PublishResult,
  type Shot,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { applyEvent } from '../internal/data'
import { enqueueJob } from '../jobs/queue'
import { providersMode } from '../lib/env'
import { PRESENTER_TOOL, type ScriptDraft } from '../providers/llm'
import { assertXTitleFits, describePublication } from './attribution'
import { instantAt } from './dates'
import { activeDiscountCodeFor } from './discounts'
import { earliestPublishAt, formatFor, formatsFor, platformsOf } from './formats'
import { assertLengthFitsKind, assertPostFits, findXPublication } from './posts'
import { workspaceOf } from './workspace'
import { refusal } from '../lib/errors'

/**
 * Episode rules that touch several tables at once: approval and its sign-in
 * checks, what happens when the runner finishes a render, how publications
 * and tracked links are created, and what a live publication does to the
 * episode. Operator mutations and agent actions both call these.
 */

/**
 * One planned episode. A video goes to every platform the persona has; a post
 * goes only to X, at one of the day's post slots (shared `postSlotHours`),
 * with the intent and the length the planner chose for that slot.
 */
export type PlannedEpisodeInput = {
  personaId: Id<'personas'>
  plannedFor: string
  concept: string
  pillar: string
  sponsorSegment: Doc<'episodes'>['sponsorSegment']
  signalIds: Id<'signals'>[]
  experimentId?: Id<'experiments'>
  variantKey?: string
} & ({ kind: 'video' } | { kind: PostKind; publishHour: number; intent: PostIntent; length: PostLength })

/** Where a new idea goes and when: a video everywhere the persona publishes, a post on X at its slot. */
function placement(persona: Doc<'personas'>, input: PlannedEpisodeInput): { platforms: Platform[]; scheduledAt: number } {
  if (input.kind === 'video') {
    const platforms = platformsOf(persona)
    return { platforms, scheduledAt: earliestPublishAt(persona, platforms, input.plannedFor) }
  }
  // Refuses by name when the persona has no X format.
  formatFor(persona, 'x')
  return { platforms: ['x'], scheduledAt: instantAt(input.plannedFor, input.publishHour, persona.timezone) }
}

/** A post's intent and length, refused when the length does not fit the kind; a video has neither. */
function postShape(input: PlannedEpisodeInput): { intent?: PostIntent; length?: PostLength } {
  if (input.kind === 'video') return {}
  assertLengthFitsKind(input.kind, input.length)
  return { intent: input.intent, length: input.length }
}

/** A new idea, queued for the writer. The operator narrows a video's platforms per episode; a post stays on X. */
export async function createIdea(ctx: MutationCtx, persona: Doc<'personas'>, input: PlannedEpisodeInput): Promise<Id<'episodes'>> {
  const now = Date.now()
  const { platforms, scheduledAt } = placement(persona, input)
  const shape = postShape(input)
  const episodeId = await ctx.db.insert('episodes', {
    personaId: input.personaId,
    slug: `${slugify(input.concept) || 'episode'}-${makeSlug(4)}`,
    kind: input.kind,
    ...shape,
    status: 'idea',
    concept: input.concept,
    title: input.concept,
    hook: '',
    script: { hook: '', body: '', sponsor: '', cta: '' },
    sponsorSegment: input.sponsorSegment,
    platforms,
    shots: [],
    renders: [],
    plannedFor: input.plannedFor,
    scheduledAt,
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

/**
 * The writer's beats become shots the way the delivery asks: a talking head
 * speaks every beat to camera, a screen-only episode records every beat, and
 * screen with avatar opens on the presenter saying the hook before the screens.
 * A presenter beat has no screen to record, so it is a take under every
 * delivery: the beats a talking-head script stored survive a widening to a
 * screen delivery.
 */
export function shotsFromDraft(draft: Pick<ScriptDraft, 'hook' | 'shotPlan'>, sponsorName: string, delivery: Delivery): Shot[] {
  return draft.shotPlan.map((beat, index) => {
    const id = `shot-${index + 1}`
    if (delivery === 'talking_head' || beat.tool === PRESENTER_TOOL) {
      return { kind: 'avatar', id, title: beat.title, voiceover: beat.voiceover }
    }
    if (delivery === 'screen_with_avatar' && index === 0) return { kind: 'avatar', id, title: beat.title, voiceover: draft.hook }
    if (beat.tool.toLowerCase() === sponsorName.toLowerCase()) {
      return {
        kind: 'screen',
        id,
        title: beat.title,
        voiceover: beat.voiceover,
        recipe: [
          { step: 'goto', url: beat.url },
          { step: 'wait', ms: 1500 },
          { step: 'scroll', y: 400 },
          { step: 'wait', ms: 1500 },
        ],
      }
    }
    return {
      kind: 'screen',
      id,
      title: beat.title,
      voiceover: beat.voiceover,
      recipe: [
        { step: 'goto', url: beat.url },
        { step: 'wait', ms: 2000 },
      ],
    }
  })
}

/**
 * The format an episode is written to for the platforms it goes to, and the
 * shots that format's delivery records. Scripting stores both; changing the
 * platforms of a scripted episode derives them again from the stored beats.
 */
export function formatAndShots(args: {
  persona: Pick<Doc<'personas'>, 'formats'>
  platforms: Platform[]
  draft: Pick<ScriptDraft, 'hook' | 'shotPlan'>
  sponsorName: string
}): { format: EpisodeFormat; shots: Shot[] } {
  const format = resolveEpisodeFormat(formatsFor(args.persona, args.platforms))
  return { format, shots: shotsFromDraft(args.draft, args.sponsorName, format.delivery) }
}

/**
 * Where an episode goes, narrowed or widened within the persona's platforms.
 * Open while nothing is recorded: an idea only moves its publish time, a
 * scripted episode also gets the format and shots of its new platforms.
 */
export async function setEpisodePlatforms(ctx: MutationCtx, episodeId: Id<'episodes'>, platforms: Platform[]): Promise<void> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  if (isPost(episode.kind)) throw refusal('A post goes only to X.')
  if (!platformsOpen(episode.status))
    throw refusal(`The platforms are locked once recording starts; this episode is at "${EPISODE_STATUS_LABELS[episode.status]}".`)
  const persona = await ctx.db.get(episode.personaId)
  if (!persona) throw new Error(`persona ${episode.personaId} not found`)
  const chosen = formatsFor(persona, platforms).map((format) => format.platform)
  if (chosen.length === 0) throw refusal('An episode needs at least one platform.')
  const base = { platforms: chosen, scheduledAt: earliestPublishAt(persona, chosen, episode.plannedFor), updatedAt: Date.now() }
  if (episode.status === 'idea') {
    await ctx.db.patch(episodeId, base)
    return
  }
  if (!episode.shotPlan) throw new Error(`episode ${episodeId} is scripted but has no shot plan to derive its shots from`)
  const workspace = await workspaceOf(ctx, persona)
  const derived = formatAndShots({
    persona,
    platforms: chosen,
    draft: { hook: episode.hook, shotPlan: episode.shotPlan },
    sponsorName: workspace.sponsorName,
  })
  await ctx.db.patch(episodeId, { ...base, ...derived })
}

/**
 * A platform leaves the persona's settings. Every episode still going there
 * is narrowed to what remains while its platforms are open, left alone once
 * it is live, measured or killed, and refused by name while an agent is in
 * the middle of it. Every refusal is found before anything is narrowed, so a
 * refused save changes nothing. Runs after the persona's formats are saved,
 * so the narrowed episodes derive their format from the new settings.
 */
export async function reconcilePlatformDrop(ctx: MutationCtx, personaId: Id<'personas'>, dropped: Platform[]): Promise<void> {
  if (dropped.length === 0) return
  const episodes = await ctx.db
    .query('episodes')
    .withIndex('by_persona', (q) => q.eq('personaId', personaId))
    .collect()
  const narrowing: { episodeId: Id<'episodes'>; title: string; platforms: Platform[] }[] = []
  for (const episode of episodes) {
    const gone = dropped.filter((platform) => episode.platforms.includes(platform))
    if (gone.length === 0) continue
    if (episode.status === 'published' || episode.status === 'measured' || episode.status === 'killed') continue
    const goneLabel = gone.map((platform) => PLATFORM_LABELS[platform]).join(' and ')
    if (!platformsOpen(episode.status)) {
      throw refusal(
        `"${episode.title}" is at "${EPISODE_STATUS_LABELS[episode.status]}" with ${goneLabel} in its cuts. Kill it, or remove ${goneLabel} once it is published.`
      )
    }
    const remaining = episode.platforms.filter((platform) => !dropped.includes(platform))
    if (remaining.length === 0) throw refusal(`"${episode.title}" goes only to ${goneLabel}. Kill it, or keep ${goneLabel}.`)
    narrowing.push({ episodeId: episode._id, title: episode.title, platforms: remaining })
  }
  if (narrowing.length === 0) return
  for (const next of narrowing) await setEpisodePlatforms(ctx, next.episodeId, next.platforms)
  // Nothing silent (PRODUCT.md): the persona says in its chat which episodes it moved off the platform.
  const droppedLabel = dropped.map((platform) => PLATFORM_LABELS[platform]).join(' and ')
  const lines = narrowing.map(
    (next) => `"${next.title}" now goes to ${next.platforms.map((platform) => PLATFORM_LABELS[platform]).join(', ')}.`
  )
  await ctx.db.insert('messages', {
    personaId,
    author: 'persona',
    text: `${droppedLabel} is off my list, so I took it out of my open episodes. ${lines.join(' ')}`,
    createdAt: Date.now(),
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
 * Approval. A text post or a thread has nothing to record, so it is
 * scheduled with its X publication at once. An image post goes to the
 * producer for its card. A video either starts recording, or a sign-in is
 * missing and it waits on the operator with a checklist item that opens the
 * runner's browser at the tool; a talking-head video opens no screen, so it
 * never waits.
 */
export async function approveEpisode(ctx: MutationCtx, episodeId: Id<'episodes'>): Promise<void> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  const persona = await ctx.db.get(episode.personaId)
  if (!persona) throw new Error(`persona ${episode.personaId} not found`)
  const workspace = await workspaceOf(ctx, persona)

  await ctx.db.patch(episodeId, { approvedAt: Date.now() })
  if (episode.kind === 'text' || episode.kind === 'thread') {
    await createPostPublication(ctx, episode, persona, { mock: providersMode() === 'mock' })
    await applyEvent(ctx, episodeId, { type: 'scheduled' })
    return
  }
  if (episode.kind === 'image') {
    assertPostFits(episode.kind, episode.post)
    await applyEvent(ctx, episodeId, { type: 'approved' })
    await startProduction(ctx, episode, persona)
    return
  }
  if (episode.platforms.includes('x')) assertXTitleFits(episode.title)
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
        action: { kind: 'open_browser', url: `${localHost(host) ? 'http' : 'https'}://${host}` },
        createdAt: Date.now(),
      })
    }
    return
  }
  await applyEvent(ctx, episodeId, { type: 'approved' })
  await startProduction(ctx, episode, persona)
}

/**
 * The producer renders a video once per aspect its platforms publish, as
 * fixed when it was scripted, and an image post's one title card. A text post
 * or a thread has nothing to produce.
 */
export async function startProduction(ctx: MutationCtx, episode: Doc<'episodes'>, persona: Doc<'personas'>): Promise<void> {
  const payload = producePayload(episode, persona)
  await enqueueJob(ctx, { kind: 'produce', payload, personaId: persona._id, episodeId: episode._id })
}

function producePayload(episode: Doc<'episodes'>, persona: Doc<'personas'>): ProducePayload {
  switch (episode.kind) {
    case 'video': {
      if (!episode.format) throw new Error(`episode ${episode._id} has no format: it cannot be produced before it is scripted`)
      return {
        kind: 'video',
        episodeId: episode._id,
        personaHandle: persona.handle,
        voiceId: persona.voiceId,
        shots: episode.shots,
        aspects: formatAspects(episode.format),
      }
    }
    case 'image': {
      const cardTitle = episode.post?.cardTitle
      if (cardTitle === undefined)
        throw new Error(`image post ${episode._id} has no card title: it cannot be rendered before it is written`)
      return { kind: 'image', episodeId: episode._id, cardTitle, personaName: persona.name, handle: persona.handle }
    }
    case 'text':
    case 'thread':
      throw new Error(`episode ${episode._id} is a ${episode.kind} post: it has nothing to produce`)
  }
}

/**
 * The runner rendered the episode: store renders, then queue one publication
 * per cut the episode was produced to, each with the cut's aspect at that
 * platform's current hour. The cut is the episode's own, frozen when it was
 * scripted; the hour and timezone are the persona's today. An image post
 * rendered its card and gets its one X publication instead.
 */
export async function completeProduction(ctx: MutationCtx, episodeId: Id<'episodes'>, result: ProduceResult): Promise<void> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  const persona = await ctx.db.get(episode.personaId)
  if (!persona) throw new Error(`persona ${episode.personaId} not found`)
  if (episode.kind === 'text' || episode.kind === 'thread')
    throw new Error(`episode ${episodeId} is a ${episode.kind} post: it has no render`)
  const workspace = await workspaceOf(ctx, persona)

  await ctx.db.patch(episodeId, {
    renders: result.renders.map((render) => ({ ...render, storageId: render.storageId as Id<'_storage'> })),
    updatedAt: Date.now(),
  })
  await applyEvent(ctx, episodeId, { type: 'produced' })

  // An image post's card goes out with the post, at the post's own slot.
  if (episode.kind === 'image') {
    await createPostPublication(ctx, episode, persona, { mock: result.renders.some((render) => render.mock) })
    await applyEvent(ctx, episodeId, { type: 'scheduled' })
    return
  }
  if (!episode.format) throw new Error(`episode ${episodeId} has no format: it cannot be scheduled before it is scripted`)

  // The same code on every platform: the episode's own, else the persona's.
  const discountCode = await activeDiscountCodeFor(ctx, persona._id, episodeId)
  for (const cut of episode.format.cuts) {
    const platform = cut.platform
    const existing = await ctx.db
      .query('publications')
      .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
      .filter((q) => q.eq(q.field('platform'), platform))
      .first()
    const scheduledAt = instantAt(episode.plannedFor, formatFor(persona, platform).publishHour, persona.timezone)
    const mock = result.renders.some((render) => render.mock)
    if (existing) {
      // A publication that failed before goes out again from this render, with today's text and hour; anything
      // queued, uploading or live stays as it is.
      if (existing.status !== 'failed') continue
      const link = await ctx.db.get(existing.linkId)
      if (!link) throw new Error(`link ${existing.linkId} not found`)
      await ctx.db.patch(existing._id, {
        status: 'queued',
        aspect: cut.aspect,
        title: episode.title,
        ...describePublication({ workspace, episode, platform, linkSlug: link.slug, discountCode }),
        scheduledAt,
        mock,
        error: undefined,
      })
      continue
    }
    const linkId = await createTrackedLink(ctx, { persona, episode, platform, target: workspace.sponsorUrl })
    const link = await ctx.db.get(linkId)
    if (!link) throw new Error('link vanished')
    await ctx.db.insert('publications', {
      episodeId,
      personaId: persona._id,
      platform,
      aspect: cut.aspect,
      status: 'queued',
      title: episode.title,
      ...describePublication({ workspace, episode, platform, linkSlug: link.slug, discountCode }),
      linkId,
      scheduledAt,
      mock,
    })
  }
  await ctx.db.patch(episodeId, { scheduledAt: earliestPublishAt(persona, episode.platforms, episode.plannedFor) })
  await applyEvent(ctx, episodeId, { type: 'scheduled' })
}

/**
 * A post's one publication, on X at the post's slot, with the parts exactly
 * as written: no footer, no code. It gets a tracked link of its own like
 * every publication (the schema's one link per publication); the post does
 * not print it. An image post's publication carries its card's aspect.
 */
export async function createPostPublication(
  ctx: MutationCtx,
  episode: Doc<'episodes'>,
  persona: Doc<'personas'>,
  args: { mock: boolean }
): Promise<Id<'publications'>> {
  if (!isPost(episode.kind)) throw new Error(`episode ${episode._id} is a video: its publications follow its render`)
  const post = assertPostFits(episode.kind, episode.post)
  const existing = await findXPublication(ctx, episode._id)
  if (existing) {
    // A post approved again after its publication failed (a rewrite, a retry) sends the new words at the new slot.
    if (existing.status !== 'failed') return existing._id
    await ctx.db.patch(existing._id, {
      status: 'queued',
      aspect: episode.kind === 'image' ? X_IMAGE_ASPECT : undefined,
      title: episode.title,
      parts: post.parts,
      scheduledAt: episode.scheduledAt,
      mock: args.mock,
      error: undefined,
    })
    return existing._id
  }
  const workspace = await workspaceOf(ctx, persona)
  const linkId = await createTrackedLink(ctx, { persona, episode, platform: 'x', target: workspace.sponsorUrl })
  return ctx.db.insert('publications', {
    episodeId: episode._id,
    personaId: persona._id,
    platform: 'x',
    aspect: episode.kind === 'image' ? X_IMAGE_ASPECT : undefined,
    status: 'queued',
    title: episode.title,
    parts: post.parts,
    linkId,
    scheduledAt: episode.scheduledAt,
    mock: args.mock,
  })
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

/** Local tools (n8n in docker, a dev server) answer on http; everything else on https. */
function localHost(host: string): boolean {
  return host.startsWith('localhost') || host.startsWith('127.0.0.1')
}
