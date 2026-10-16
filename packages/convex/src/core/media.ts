import {
  ASSET_NAME_MAX,
  EPISODE_STATUS_LABELS,
  ASSET_NOTE_MAX,
  CLIP_SECONDS,
  GENERATED_TAG,
  assetKindOf,
  budgetProblem,
  generationPromptProblem,
  providerPrompt,
  textEditable,
  type MediaKind,
  type MediaSpend,
  type PersonaColor,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { enqueueJob } from '../jobs/queue'
import { refusal } from '../lib/errors'
import { dayKey, instantAt } from './dates'
import { approveEpisode, shotsFromDraft } from './episodes'
import type { StoredBeat } from '../lib/validators'
import { workspaceOf } from './workspace'

/**
 * Generated media (docs/plan.md, slice 15): the stills and clips the producer
 * makes from a prompt, for a beat of a script or for the operator on the
 * Assets page. A generation is checked against the prompt rules when it is
 * asked for, against the persona's daily budget when it starts, and saved to
 * the asset library as the producer's when it is done, tagged generated.
 */

type Reader = { db: QueryCtx['db'] }

/**
 * Asks the producer for a picture: the prompt is checked against the rules
 * (shared `generationPromptProblem`), and a generate_media job queued. The job
 * carries no episode, so a picture that cannot be made never fails its
 * episode: the beat says why, and approval waits.
 */
export async function requestGeneration(
  ctx: MutationCtx,
  persona: Doc<'personas'>,
  args: { kind: MediaKind; prompt: string; episodeId?: Id<'episodes'>; beatIndex?: number; now: number }
): Promise<Id<'generations'>> {
  const workspace = await workspaceOf(ctx, persona)
  const problem = generationPromptProblem(args.prompt, workspace.sponsorName)
  if (problem) throw refusal(problem)
  const generationId = await ctx.db.insert('generations', {
    personaId: persona._id,
    kind: args.kind,
    prompt: args.prompt.trim(),
    episodeId: args.episodeId,
    beatIndex: args.beatIndex,
    status: 'queued',
    seconds: args.kind === 'clip' ? CLIP_SECONDS : 0,
    createdAt: args.now,
  })
  await enqueueJob(ctx, { kind: 'generate_media', payload: { generationId }, personaId: persona._id })
  return generationId
}

/**
 * Every picture a freshly written script asks for: one generation per beat
 * that asks and has none yet, its id stamped on the beat so the result finds
 * its way back.
 */
export async function requestEpisodeGenerations(ctx: MutationCtx, episodeId: Id<'episodes'>, now: number): Promise<number> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  const persona = await ctx.db.get(episode.personaId)
  if (!persona) throw new Error(`persona ${episode.personaId} not found`)
  const beats = [...(episode.shotPlan ?? [])]
  let requested = 0
  for (const [index, beat] of beats.entries()) {
    if (!beat.generate || beat.generate.generationId !== undefined || beat.assetId !== undefined) continue
    const generationId = await requestGeneration(ctx, persona, {
      kind: beat.generate.kind,
      prompt: beat.generate.prompt,
      episodeId,
      beatIndex: index,
      now,
    })
    beats[index] = { ...beat, generate: { ...beat.generate, generationId } }
    requested += 1
  }
  if (requested > 0) await ctx.db.patch(episodeId, { shotPlan: beats })
  return requested
}

/**
 * The beat asks again: a new generation from the same prompt, which replaces
 * the picture once it is made. The one it had stays in the library, to reuse
 * or delete.
 */
export async function regenerateBeat(
  ctx: MutationCtx,
  episodeId: Id<'episodes'>,
  beatIndex: number,
  now: number
): Promise<Id<'generations'>> {
  const episode = await ctx.db.get(episodeId)
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  const beat = episode.shotPlan?.[beatIndex]
  if (!beat?.generate) throw new Error(`beat ${beatIndex + 1} of episode ${episodeId} asks for no generated picture`)
  if (beat.generate.generationId !== undefined) {
    const current = await ctx.db.get(beat.generate.generationId)
    if (current && (current.status === 'queued' || current.status === 'running'))
      throw refusal('The producer is still making this picture; wait for it before asking again.')
  }
  if (!textEditable(episode.status))
    throw refusal(`The script is locked once recording starts; this episode is at "${EPISODE_STATUS_LABELS[episode.status]}".`)
  const persona = await ctx.db.get(episode.personaId)
  if (!persona) throw new Error(`persona ${episode.personaId} not found`)
  const generationId = await requestGeneration(ctx, persona, {
    kind: beat.generate.kind,
    prompt: beat.generate.prompt,
    episodeId,
    beatIndex,
    now,
  })
  // The picture that missed leaves the beat, so approval waits for the new one; it stays in the library.
  await setBeat(ctx, episode, beatIndex, {
    title: beat.title,
    voiceover: beat.voiceover,
    tool: beat.tool,
    url: beat.url,
    generate: { ...beat.generate, generationId },
  })
  return generationId
}

/** One beat replaced, and the shots derived from the beats again, since the beat's picture decides its shot. */
async function setBeat(ctx: MutationCtx, episode: Doc<'episodes'>, beatIndex: number, beat: StoredBeat): Promise<void> {
  const persona = await ctx.db.get(episode.personaId)
  if (!persona) throw new Error(`persona ${episode.personaId} not found`)
  const workspace = await workspaceOf(ctx, persona)
  const shotPlan = [...(episode.shotPlan ?? [])]
  shotPlan[beatIndex] = beat
  const update: Partial<Doc<'episodes'>> = { shotPlan, updatedAt: Date.now() }
  if (episode.format) update.shots = shotsFromDraft({ shotPlan }, workspace.sponsorName, episode.format.delivery)
  await ctx.db.patch(episode._id, update)
}

/** The start of the persona's day, in its timezone: the budget counts from here. */
function dayStart(persona: Pick<Doc<'personas'>, 'timezone'>, now: number): number {
  return instantAt(dayKey(now, persona.timezone), 0, persona.timezone)
}

/** What the persona generated today: the generations started since its midnight that did not fail. */
export async function spentToday(ctx: Reader, persona: Doc<'personas'>, now: number): Promise<MediaSpend> {
  const started = await ctx.db
    .query('generations')
    .withIndex('by_persona_started', (q) => q.eq('personaId', persona._id).gte('startedAt', dayStart(persona, now)))
    .collect()
  const counted = started.filter((generation) => generation.status !== 'failed')
  return {
    images: counted.filter((generation) => generation.kind === 'image').length,
    clipSeconds: counted.reduce((sum, generation) => sum + (generation.kind === 'clip' ? generation.seconds : 0), 0),
  }
}

/** What the provider is asked for once a generation starts. */
export interface StartedGeneration {
  kind: MediaKind
  prompt: string
  shownPrompt: string
  personaName: string
  color: PersonaColor
}

/**
 * A generation starts: within the day's budget it is running and the
 * provider gets its prompt in the persona's look; past it, it fails with the
 * budget in its error. A failed one may start again (Generate again, or the
 * job's retry).
 */
export async function startGeneration(
  ctx: MutationCtx,
  generationId: Id<'generations'>,
  now: number
): Promise<{ status: 'started'; request: StartedGeneration } | { status: 'refused'; message: string }> {
  const generation = await ctx.db.get(generationId)
  if (!generation) throw new Error(`generation ${generationId} not found`)
  if (generation.status === 'running' || generation.status === 'done')
    throw new Error(`generation ${generationId} is already ${generation.status}`)
  const persona = await ctx.db.get(generation.personaId)
  if (!persona) throw new Error(`persona ${generation.personaId} not found`)
  const problem = budgetProblem(generation.kind, await spentToday(ctx, persona, now))
  if (problem) {
    await ctx.db.patch(generationId, { status: 'failed', error: problem, doneAt: now })
    return { status: 'refused', message: problem }
  }
  await ctx.db.patch(generationId, { status: 'running', startedAt: now, error: undefined })
  return {
    status: 'started',
    request: {
      kind: generation.kind,
      prompt: providerPrompt(generation.prompt, persona.appearance?.style ?? null),
      shownPrompt: generation.prompt,
      personaName: persona.name,
      color: persona.color,
    },
  }
}

/** A name for the asset from its prompt: the words, cut at a word to the name limit. */
function nameFromPrompt(prompt: string): string {
  const words = prompt.trim().replace(/[.!?]+$/, '')
  if (words.length <= ASSET_NAME_MAX) return words
  const cut = words.slice(0, ASSET_NAME_MAX - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1))}…`
}

/**
 * The provider's file becomes the producer's asset, tagged generated, with
 * the prompt and the model in its note. A beat that still waits for this
 * generation shows it from now on; one that asked again meanwhile, or an
 * episode killed meanwhile, leaves it in the library only.
 */
export async function finishGeneration(
  ctx: MutationCtx,
  generationId: Id<'generations'>,
  file: { storageId: Id<'_storage'>; contentType: string; model: string; mock: boolean },
  now: number
): Promise<Id<'assets'>> {
  const generation = await ctx.db.get(generationId)
  if (!generation) throw new Error(`generation ${generationId} not found`)
  if (generation.status !== 'running') throw new Error(`generation ${generationId} is ${generation.status}, not running`)
  const stored = await ctx.db.system.get(file.storageId)
  if (!stored) throw new Error(`the file of generation ${generationId} is not in storage`)
  // The provider says what it made; the type storage recorded can be missing.
  const contentType = file.contentType
  const kind = assetKindOf(contentType)
  if (kind !== 'image' && kind !== 'clip')
    throw new Error(`the media provider returned ${contentType || 'a file of no type'}, which no beat shows`)
  const note = `Generated by ${file.model} from: "${generation.prompt}"`
  const assetId = await ctx.db.insert('assets', {
    personaId: generation.personaId,
    storageId: file.storageId,
    kind,
    name: nameFromPrompt(generation.prompt),
    tags: [GENERATED_TAG],
    note: note.length <= ASSET_NOTE_MAX ? note : `${note.slice(0, ASSET_NOTE_MAX - 2)}…"`,
    contentType,
    size: stored.size,
    source: 'producer',
    episodeId: generation.episodeId,
    createdAt: now,
  })
  await ctx.db.patch(generationId, { status: 'done', assetId, model: file.model, mock: file.mock, doneAt: now })
  if (generation.episodeId !== undefined && generation.beatIndex !== undefined) {
    await placeGenerated(ctx, generation.episodeId, generation.beatIndex, generationId, assetId)
  }
  return assetId
}

async function placeGenerated(
  ctx: MutationCtx,
  episodeId: Id<'episodes'>,
  beatIndex: number,
  generationId: Id<'generations'>,
  assetId: Id<'assets'>
): Promise<void> {
  const episode = await ctx.db.get(episodeId)
  if (!episode || episode.status === 'killed') return
  const beat = episode.shotPlan?.[beatIndex]
  if (beat?.generate?.generationId !== generationId) return
  await setBeat(ctx, episode, beatIndex, { ...beat, assetId })
  // An auto-approving persona's script waited only for its pictures; with the last one in place it is approved.
  const placed = await ctx.db.get(episodeId)
  const persona = await ctx.db.get(episode.personaId)
  if (!placed || !persona) throw new Error(`episode ${episodeId} or its persona vanished`)
  if (
    placed.status === 'scripted' &&
    persona.autoApprove &&
    persona.voiceId !== undefined &&
    (await pendingPictureProblem(ctx, placed)) === null
  ) {
    await approveEpisode(ctx, episodeId)
  }
}

export async function failGeneration(ctx: MutationCtx, generationId: Id<'generations'>, error: string, now: number): Promise<void> {
  const generation = await ctx.db.get(generationId)
  if (!generation) throw new Error(`generation ${generationId} not found`)
  await ctx.db.patch(generationId, { status: 'failed', error, doneAt: now })
}

/**
 * Why a video cannot be approved for recording yet: a beat whose picture is
 * still being made, or could not be made. None when every asked-for picture
 * is in place.
 */
export async function pendingPictureProblem(ctx: Reader, episode: Doc<'episodes'>): Promise<string | null> {
  for (const [index, beat] of (episode.shotPlan ?? []).entries()) {
    if (!beat.generate || beat.assetId !== undefined) continue
    const generation = beat.generate.generationId === undefined ? null : await ctx.db.get(beat.generate.generationId)
    if (generation?.status === 'failed')
      return `The picture for beat ${index + 1} could not be made: ${generation.error ?? 'no reason given'} Generate it again on the beat, or rewrite the script.`
    return `The producer is still making the picture for beat ${index + 1}; approve once it is made.`
  }
  return null
}
