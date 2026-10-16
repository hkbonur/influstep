import {
  EPISODE_STATUS_LABELS,
  PLATFORM_LABELS,
  X_IMAGE_ASPECT,
  canTransition,
  effectiveVariant,
  formatAspects,
  isPost,
  makeSlug,
  platformsOpen,
  resolveEpisodeFormat,
  scriptDayOf,
  slugify,
  variantLength,
  type Delivery,
  type EffectiveVariant,
  type EpisodeFormat,
  type Platform,
  type PostIntent,
  type PostKind,
  type PostLength,
  type ProducePayload,
  type ProduceResult,
  type PublishResult,
  type Beat,
  type Shot,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { applyEvent, failEpisodeIfPossible } from '../internal/data'
import { enqueueJob, markFailed } from '../jobs/queue'
import { providersMode } from '../lib/env'
import { PRESENTER_TOOL } from '../providers/llm'
import { shotAssets, saveProduced } from './assets'
import { assertXTitleFits } from './attribution'
import { dayKey, hourAt, instantAt } from './dates'
import { episodeEffectiveVariant, episodeVariant, plannedVariant } from './experiments'
import { earliestPublishAt, formatFor, formatsFor, platformsOf, publishHourFor, publishOffset } from './formats'
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
 * One planned episode. A video goes to every platform the persona has, or to
 * the platforms it is given (a replacement keeps those of the episode it
 * replaces); a post goes only to X, at one of the day's post slots (shared
 * `postSlotHours`), with the intent and the length the planner chose for that
 * slot.
 */
export type PlannedEpisodeInput = {
  personaId: Id<'personas'>
  plannedFor: string
  concept: string
  // A replacement keeps the pillar of the episode it replaces, which an episode planned without one never had.
  pillar?: string
  sponsorSegment: Doc<'episodes'>['sponsorSegment']
  signalIds: Id<'signals'>[]
  experimentId?: Id<'experiments'>
  variantKey?: string
} & ({ kind: 'video'; platforms?: Platform[] } | { kind: PostKind; publishHour: number; intent: PostIntent; length: PostLength })

/**
 * Where a new idea goes and when: a video everywhere the persona publishes,
 * at its platforms' hours moved by its publish offset; a post on X at its slot.
 */
function placement(persona: Doc<'personas'>, input: PlannedEpisodeInput, offset: number): { platforms: Platform[]; scheduledAt: number } {
  if (input.kind === 'video') {
    // formatsFor refuses a platform the persona does not have, and keeps PLATFORMS order.
    const platforms =
      input.platforms === undefined ? platformsOf(persona) : formatsFor(persona, input.platforms).map((format) => format.platform)
    return { platforms, scheduledAt: earliestPublishAt(persona, platforms, input.plannedFor, offset) }
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

/**
 * A new idea. The writer gets it the day before it goes out (`queueScriptIfDue`),
 * so an idea for today or tomorrow is queued at once and a later one waits.
 * The operator narrows a video's platforms per episode; a post stays on X.
 */
export async function createIdea(ctx: MutationCtx, persona: Doc<'personas'>, input: PlannedEpisodeInput): Promise<Id<'episodes'>> {
  const now = Date.now()
  // The planner assigns variants of the running experiment only, so a new idea never carries one of a decided
  // test, whose offset `videoPublishOffset` drops.
  const offset =
    input.kind === 'video'
      ? publishOffset(
          effectiveVariant(
            'publish_time',
            { variant: await plannedVariant(ctx, input), sponsorSegment: input.sponsorSegment },
            persona.strategy?.defaults
          )
        )
      : 0
  const { platforms, scheduledAt } = placement(persona, input, offset)
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
  await queueScriptIfDue(ctx, persona, { _id: episodeId, status: 'idea', plannedFor: input.plannedFor }, now)
  return episodeId
}

/**
 * Whether the writer is on the episode now: a write of its script is queued
 * or running. The studio's "Writing now" and the chat's "The writer is on it"
 * read it, and `queueScriptIfDue` never queues a second write beside one.
 */
export async function scriptBeingWritten(ctx: { db: QueryCtx['db'] }, episodeId: Id<'episodes'>): Promise<boolean> {
  const jobs = await ctx.db
    .query('jobs')
    .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
    .collect()
  return jobs.some((job) => {
    if (job.kind !== 'write_script') return false
    return job.status === 'queued' || job.status === 'running'
  })
}

/** What `queueScriptIfDue` did: queued the write, found it already queued, or left the idea waiting for its day. */
export type ScriptQueueOutcome = 'queued' | 'waiting' | 'already'

/**
 * The one place a script is queued (docs/plan.md, v0.2 item 9). A script is
 * written the day before its episode goes out (shared `scriptDayOf`), after
 * that morning's sweep, so the writer reads what moved and the last check can
 * swap a concept that went cold. An idea on or after its script day with no
 * write already queued or running is queued now; anything else waits. Today
 * is the persona's own calendar day.
 */
export async function queueScriptIfDue(
  ctx: MutationCtx,
  persona: Pick<Doc<'personas'>, '_id' | 'timezone'>,
  episode: Pick<Doc<'episodes'>, '_id' | 'status' | 'plannedFor'>,
  now: number
): Promise<ScriptQueueOutcome> {
  if (episode.status !== 'idea') return 'waiting'
  if (await scriptBeingWritten(ctx, episode._id)) return 'already'
  if (dayKey(now, persona.timezone) < scriptDayOf(episode.plannedFor)) return 'waiting'
  await enqueueJob(ctx, { kind: 'write_script', payload: { episodeId: episode._id }, personaId: persona._id, episodeId: episode._id })
  return 'queued'
}

/** Why the morning's due-script pass fails an idea nobody wrote in time. */
export const DAY_PASSED = 'Its day passed before the script was written.'

/**
 * The persona's ideas on the morning's due-script pass (internal/schedule.ts
 * `writeDueScripts`, after the sweep): an idea whose day is already past
 * fails, since a script for it would go out late or never; every other idea
 * goes through `queueScriptIfDue`, so tomorrow's are written now, after the
 * last check. Videos and posts alike.
 */
export async function queueDueScripts(
  ctx: MutationCtx,
  persona: Pick<Doc<'personas'>, '_id' | 'timezone'>,
  now: number
): Promise<{ queued: number; failed: number }> {
  const today = dayKey(now, persona.timezone)
  const episodes = await ctx.db
    .query('episodes')
    .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
    .collect()
  let queued = 0
  let failed = 0
  for (const episode of episodes) {
    if (episode.status !== 'idea') continue
    if (episode.plannedFor < today) {
      await failEpisodeIfPossible(ctx, episode._id, DAY_PASSED)
      failed += 1
      continue
    }
    if ((await queueScriptIfDue(ctx, persona, episode, now)) === 'queued') queued += 1
  }
  return { queued, failed }
}

/**
 * How many hours a video's publications move from its platforms' usual hours:
 * its publish time variant's offset while its test is not decided, or 0
 * outside a publish time test.
 */
async function videoPublishOffset(
  ctx: MutationCtx,
  episode: Pick<Doc<'episodes'>, '_id' | 'variantKey' | 'experimentId' | 'sponsorSegment'>,
  persona: Pick<Doc<'personas'>, 'strategy'>
): Promise<number> {
  const experiment = episode.experimentId === undefined ? null : await ctx.db.get(episode.experimentId)
  // A decided publish time test moved formats[].publishHour by the winner's offset (applyExperimentDecision), so
  // the variant an episode of it still carries would move the hour a second time: a "Three hours later" video
  // rendered after that variant won would go out six hours late. A decided test of any other dimension moves no
  // hour either, since no publish time default is ever stored. A stopped test moved no hours, so its episodes
  // keep their variant's offset.
  if (experiment?.status === 'decided') return 0
  return publishOffset(
    effectiveVariant(
      'publish_time',
      { variant: episodeVariant(episode, experiment), sponsorSegment: episode.sponsorSegment },
      persona.strategy?.defaults
    )
  )
}

/** A video's beats as the writer or the beat editor leaves them: the only script (shared `Beat`). */
export interface BeatsDraft {
  shotPlan: readonly Beat[]
}

/**
 * The beats become shots the way the delivery asks, each speaking its own
 * beat's voiceover, so the recording says exactly what the script says: a
 * talking head speaks every beat to camera, a screen-only episode records
 * every beat, and screen with avatar opens on the presenter speaking the
 * first beat before the screens. A presenter beat has no screen to record, so
 * it is a take under every delivery: the beats a talking-head script stored
 * survive a widening to a screen delivery.
 */
export function shotsFromDraft(draft: BeatsDraft, sponsorName: string, delivery: Delivery): Shot[] {
  return draft.shotPlan.map((beat, index) => {
    const id = `shot-${index + 1}`
    // An asset the writer placed shows under every delivery: the beat asked for that picture, not a screen or a face.
    if (beat.assetId !== undefined) return { kind: 'asset', id, title: beat.title, voiceover: beat.voiceover, assetId: beat.assetId }
    const presenter = delivery === 'talking_head' || beat.tool === PRESENTER_TOOL || (delivery === 'screen_with_avatar' && index === 0)
    if (presenter) return { kind: 'avatar', id, title: beat.title, voiceover: beat.voiceover }
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
 * The length is the formats' scaled by the episode's effective length variant
 * (shared `effectiveVariant`), the same the writer's brief asks for.
 */
export function formatAndShots(args: {
  persona: Pick<Doc<'personas'>, 'formats'>
  platforms: Platform[]
  draft: BeatsDraft
  sponsorName: string
  length: EffectiveVariant
}): { format: EpisodeFormat; shots: Shot[] } {
  if (args.length.kind !== 'length') throw new Error(`formatAndShots takes the length variant, not a ${args.length.kind} variant`)
  const resolved = resolveEpisodeFormat(formatsFor(args.persona, args.platforms))
  const format = { ...resolved, lengthSec: variantLength(resolved.lengthSec, args.length) }
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
  const offset = await videoPublishOffset(ctx, episode, persona)
  const base = { platforms: chosen, scheduledAt: earliestPublishAt(persona, chosen, episode.plannedFor, offset), updatedAt: Date.now() }
  if (episode.status === 'idea') {
    await ctx.db.patch(episodeId, base)
    return
  }
  if (!episode.shotPlan) throw new Error(`episode ${episodeId} is scripted but has no shot plan to derive its shots from`)
  const workspace = await workspaceOf(ctx, persona)
  const derived = formatAndShots({
    persona,
    platforms: chosen,
    draft: { shotPlan: episode.shotPlan },
    sponsorName: workspace.sponsorName,
    length: await episodeEffectiveVariant(ctx, 'length', episode, persona),
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
    // Approving a text post or a thread is approving what goes out: it has no render, so no package waits.
    await createPostPublication(ctx, episode, persona, { mock: providersMode() === 'mock', status: 'queued' })
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
  // Every publication off X starts from the writer's description; a video written before descriptions existed has
  // none, and is refused here rather than after a render it could not publish.
  if (episode.platforms.some((platform) => platform !== 'x') && episode.description === undefined) {
    throw refusal('The episode has no description to publish with; rewrite it.')
  }
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
  const payload = await producePayload(ctx, episode, persona)
  await enqueueJob(ctx, { kind: 'produce', payload, personaId: persona._id, episodeId: episode._id })
}

async function producePayload(ctx: MutationCtx, episode: Doc<'episodes'>, persona: Doc<'personas'>): Promise<ProducePayload> {
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
        assets: await shotAssets(ctx, episode.shots),
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

/** What a publication starts as: queued to go out, or a draft in the publish package the operator approves. */
type ArmedStatus = Extract<Doc<'publications'>['status'], 'draft' | 'queued'>

/** A persona that publishes on its own queues its publications at render; any other leaves them as a package. */
function armedStatus(persona: Doc<'personas'>): ArmedStatus {
  return persona.autoPublish ? 'queued' : 'draft'
}

/**
 * The persona's own description text of a video publication: the writer's
 * description off X, nothing on X (a video's X text is its title). Approval
 * refuses a video off X without a description, so a missing one here is a bug.
 */
function publicationBody(episode: Doc<'episodes'>, platform: Platform): string | undefined {
  if (platform === 'x') return undefined
  if (episode.description === undefined) throw new Error(`episode ${episode._id} has no description to publish on ${platform}`)
  return episode.description
}

/**
 * The runner rendered the episode: store renders, then create one publication
 * per cut the episode was produced to, each with the cut's aspect at that
 * platform's current hour, the episode's title and, off X, its description as
 * the body. The cut is the episode's own, frozen when it was scripted; the
 * hour and timezone are the persona's today. An image post rendered its card
 * and gets its one X publication instead. The episode is rendered: a persona
 * that publishes on its own schedules it at once with every publication
 * queued; otherwise the publications are drafts and the episode waits as a
 * publish package for the operator (private/publications.ts, approvePackage).
 * Nothing composes a description here: dispatch does, with the code in force
 * when the publication goes out.
 */
export async function completeProduction(ctx: MutationCtx, episodeId: Id<'episodes'>, result: ProduceResult): Promise<ProductionOutcome> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  // The operator killed it while the runner was rendering: the render has nowhere to go, and that is no failure.
  if (episode.status === 'killed') return 'killed'
  const persona = await ctx.db.get(episode.personaId)
  if (!persona) throw new Error(`persona ${episode.personaId} not found`)
  if (episode.kind === 'text' || episode.kind === 'thread')
    throw new Error(`episode ${episodeId} is a ${episode.kind} post: it has no render`)
  const workspace = await workspaceOf(ctx, persona)

  const now = Date.now()
  await ctx.db.patch(episodeId, {
    renders: result.renders.map((render) => ({ ...render, storageId: render.storageId as Id<'_storage'> })),
    updatedAt: now,
  })
  await saveProduced(ctx, episode, result, now)
  await applyEvent(ctx, episodeId, { type: 'produced' })
  const status = armedStatus(persona)
  const mock = result.renders.some((render) => render.mock)

  // An image post's card goes out with the post, at the post's own slot. Its parts are the approved post.
  if (episode.kind === 'image') {
    await createPostPublication(ctx, episode, persona, { mock, status })
    if (persona.autoPublish) await applyEvent(ctx, episodeId, { type: 'scheduled' })
    return 'stored'
  }
  if (!episode.format) throw new Error(`episode ${episodeId} has no format: it cannot be scheduled before it is scripted`)

  const offset = await videoPublishOffset(ctx, episode, persona)
  for (const cut of episode.format.cuts) {
    const platform = cut.platform
    const existing = await ctx.db
      .query('publications')
      .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
      .filter((q) => q.eq(q.field('platform'), platform))
      .first()
    const scheduledAt = instantAt(episode.plannedFor, publishHourFor(formatFor(persona, platform), offset), persona.timezone)
    const text = { title: episode.title, body: publicationBody(episode, platform) }
    if (existing) {
      // A publication that failed before goes out again from this render, with today's text and hour; a draft
      // keeps the operator's edits, and anything queued, uploading or live stays as it is. The code the failed
      // attempt was stamped with never reached viewers, so the stamp goes: dispatch stamps the code in force then.
      if (existing.status !== 'failed') continue
      await ctx.db.patch(existing._id, {
        status,
        aspect: cut.aspect,
        ...text,
        scheduledAt,
        mock,
        error: undefined,
        discountCodeId: undefined,
      })
      continue
    }
    const linkId = await createTrackedLink(ctx, { persona, episode, platform, target: workspace.sponsorUrl })
    await ctx.db.insert('publications', {
      episodeId,
      personaId: persona._id,
      platform,
      aspect: cut.aspect,
      status,
      ...text,
      linkId,
      scheduledAt,
      mock,
    })
  }
  await ctx.db.patch(episodeId, { scheduledAt: earliestPublishAt(persona, episode.platforms, episode.plannedFor, offset) })
  if (persona.autoPublish) await applyEvent(ctx, episodeId, { type: 'scheduled' })
  return 'stored'
}

/** What became of a finished render: stored on its episode, or set aside because the episode was killed meanwhile. */
export type ProductionOutcome = 'stored' | 'killed'

/**
 * A post's one publication, on X at the post's slot, with the parts exactly
 * as written: no footer, no code. It gets a tracked link of its own like
 * every publication (the schema's one link per publication); the post does
 * not print it. An image post's publication carries its card's aspect. A text
 * post or a thread is queued on approval; an image post's waits as a draft
 * after its render unless the persona publishes on its own.
 */
export async function createPostPublication(
  ctx: MutationCtx,
  episode: Doc<'episodes'>,
  persona: Doc<'personas'>,
  args: { mock: boolean; status: ArmedStatus }
): Promise<Id<'publications'>> {
  if (!isPost(episode.kind)) throw new Error(`episode ${episode._id} is a video: its publications follow its render`)
  const post = assertPostFits(episode.kind, episode.post)
  const existing = await findXPublication(ctx, episode._id)
  if (existing) {
    // A post approved again after its publication failed (a rewrite, a retry) sends the new words at the new slot.
    if (existing.status !== 'failed') return existing._id
    await ctx.db.patch(existing._id, {
      status: args.status,
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
    status: args.status,
    title: episode.title,
    parts: post.parts,
    linkId,
    scheduledAt: episode.scheduledAt,
    mock: args.mock,
  })
}

/** The link in bio's tracked link: the one a persona has for no episode and no platform. */
export function isBioLink(link: Pick<Doc<'links'>, 'episodeId' | 'platform'>): boolean {
  return link.episodeId === undefined && link.platform === undefined
}

/** The persona's bio link; none before one is made. */
export async function bioLinkOf(ctx: { db: QueryCtx['db'] }, personaId: Id<'personas'>): Promise<Doc<'links'> | null> {
  const links = await ctx.db
    .query('links')
    .withIndex('by_persona', (q) => q.eq('personaId', personaId))
    .collect()
  return links.find(isBioLink) ?? null
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

/**
 * A publication went live. Once every platform is live the episode is
 * published. A withdrawn one stays withdrawn: its episode was killed, so it
 * never turns live and never publishes the episode. Dispatch and the kill
 * rule keep an upload from running for one; this holds if one ever does.
 */
export async function completePublication(
  ctx: MutationCtx,
  publicationId: Id<'publications'>,
  result: PublishResult
): Promise<PublicationOutcome> {
  const publication = await ctx.db.get(publicationId)
  if (!publication) throw new Error(`publication ${publicationId} not found`)
  if (publication.status === 'withdrawn') return 'withdrawn'
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
  return 'live'
}

/** What became of a finished upload: live on its publication, or set aside because the publication was withdrawn. */
export type PublicationOutcome = 'live' | 'withdrawn'

export async function failPublication(ctx: MutationCtx, publicationId: Id<'publications'>, error: string): Promise<void> {
  const publication = await ctx.db.get(publicationId)
  if (!publication) throw new Error(`publication ${publicationId} not found`)
  await ctx.db.patch(publicationId, { status: 'failed', error })
  // A sibling may already have failed the episode; the second error is on the publication row.
  const episode = await ctx.db.get(publication.episodeId)
  if (!episode || !canTransition(episode.status, 'failed')) return
  await applyEvent(ctx, publication.episodeId, { type: 'failed', error: `${publication.platform}: ${error}` })
}

/** What a job of a killed episode that had not started yet fails with, so its row says why it never ran. */
export const KILLED_BEFORE_RUN = 'The episode was killed before this ran.'

/** The publications a kill withdraws: everything that has not gone out. Live ones stay live. */
const WITHDRAWN_ON_KILL: readonly Doc<'publications'>['status'][] = ['draft', 'queued', 'failed']

/**
 * The operator withdraws an episode, on its page or in chat. Nothing of it
 * goes out afterwards: every publication that has not gone out is withdrawn,
 * and every job still queued for it fails with the reason, so neither the
 * runner nor the backend picks it up. A job already running finishes against
 * a killed episode and stores nothing (`completeProduction`). A publication
 * uploading right now refuses the kill: the runner holds it and cannot be
 * called back. Every refusal comes before the first write.
 */
export async function killEpisode(ctx: MutationCtx, episodeId: Id<'episodes'>): Promise<void> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  if (!canTransition(episode.status, 'killed')) throw refusal(`An episode at "${EPISODE_STATUS_LABELS[episode.status]}" cannot be killed.`)
  const publications = await ctx.db
    .query('publications')
    .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
    .collect()
  const uploading = publications.find((publication) => publication.status === 'uploading')
  if (uploading) throw refusal(`"${episode.title}" is uploading to ${PLATFORM_LABELS[uploading.platform]}; it cannot be killed now.`)

  await applyEvent(ctx, episodeId, { type: 'killed' })
  for (const publication of publications) {
    if (!WITHDRAWN_ON_KILL.includes(publication.status)) continue
    await ctx.db.patch(publication._id, { status: 'withdrawn' })
  }
  const jobs = await ctx.db
    .query('jobs')
    .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
    .collect()
  for (const job of jobs) {
    if (job.status !== 'queued') continue
    await markFailed(ctx, job._id, KILLED_BEFORE_RUN)
  }
}

/**
 * Not yet handed to the runner and still due to go: a move takes its time
 * along. Narrower than "has not gone out": a failed publication keeps its
 * time until a retry or a new render arms it again, and a withdrawn one never
 * goes.
 */
function waitsForDispatch(publication: Doc<'publications'>): boolean {
  return publication.status === 'draft' || publication.status === 'queued'
}

/**
 * Moves an episode to another calendar day, on the calendar or in chat. An
 * episode moves for as long as it could still be killed, so never once it is
 * published, measured or killed. A video takes its platforms' hours on the new
 * day (moved by its publish offset); a post keeps its slot's hour. Every
 * publication not yet handed to the runner, a package's drafts included,
 * moves with it. An idea moved to tomorrow or today gets its script queued; a
 * scripted episode moved later keeps its script.
 */
export async function rescheduleEpisode(ctx: MutationCtx, episodeId: Id<'episodes'>, plannedFor: string): Promise<void> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  if (!canTransition(episode.status, 'killed')) throw refusal(`An episode at "${EPISODE_STATUS_LABELS[episode.status]}" cannot be moved.`)
  const persona = await ctx.db.get(episode.personaId)
  if (!persona) throw new Error(`persona ${episode.personaId} not found`)
  const publications = await ctx.db
    .query('publications')
    .withIndex('by_episode', (q) => q.eq('episodeId', episode._id))
    .collect()
  if (isPost(episode.kind)) {
    const scheduledAt = instantAt(plannedFor, hourAt(episode.scheduledAt, persona.timezone), persona.timezone)
    await ctx.db.patch(episodeId, { plannedFor, scheduledAt, updatedAt: Date.now() })
    for (const publication of publications) {
      if (waitsForDispatch(publication)) await ctx.db.patch(publication._id, { scheduledAt })
    }
    await queueScriptIfDue(ctx, persona, { _id: episode._id, status: episode.status, plannedFor }, Date.now())
    return
  }
  const offset = await videoPublishOffset(ctx, episode, persona)
  const scheduledAt = earliestPublishAt(persona, episode.platforms, plannedFor, offset)
  await ctx.db.patch(episodeId, { plannedFor, scheduledAt, updatedAt: Date.now() })
  for (const publication of publications) {
    if (!waitsForDispatch(publication)) continue
    const hour = publishHourFor(formatFor(persona, publication.platform), offset)
    await ctx.db.patch(publication._id, { scheduledAt: instantAt(plannedFor, hour, persona.timezone) })
  }
  await queueScriptIfDue(ctx, persona, { _id: episode._id, status: episode.status, plannedFor }, Date.now())
}

/** Local tools (n8n in docker, a dev server) answer on http; everything else on https. */
function localHost(host: string): boolean {
  return host.startsWith('localhost') || host.startsWith('127.0.0.1')
}
