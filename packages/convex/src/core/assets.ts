import {
  ASSET_KIND_LABELS,
  assetFileProblem,
  assetKindOf,
  assetProblems,
  isPlaceable,
  parseAssetTags,
  producedAssetName,
  sameAssetName,
  type AspectRatio,
  type AssetKind,
  type EpisodeStatus,
  type PlaceableAssetKind,
  type ProduceResult,
  type Shot,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { refusal } from '../lib/errors'
import type { StoredBeat } from '../lib/validators'
import type { DraftBeat } from '../providers/llm/types'

/**
 * A persona's asset library (docs/plan.md, v0.2 item 10): what the operator
 * uploads and the producer saves, what the writer may place in a beat, and
 * where the runner downloads a placed asset.
 */

type Reader = { db: QueryCtx['db'] }

/** How many assets the writer's brief lists, so its prompt stays short. */
const WRITER_ASSETS_MAX = 30

/** An image or a clip the writer may place in a beat, by its name. */
export interface WriterAsset {
  id: Id<'assets'>
  name: string
  kind: PlaceableAssetKind
  tags: string[]
  note: string
}

/** The persona's assets, newest first. */
async function assetsOf(ctx: Reader, personaId: Id<'personas'>): Promise<Doc<'assets'>[]> {
  const rows = await ctx.db
    .query('assets')
    .withIndex('by_persona', (q) => q.eq('personaId', personaId))
    .collect()
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * The images and clips the writer may place, the operator's uploads first and
 * then what the producer saved, each newest first: an asset the operator put
 * in the library on purpose comes before last week's renders. Two assets of
 * one name resolve to the first here.
 */
export async function writerAssets(ctx: Reader, personaId: Id<'personas'>): Promise<WriterAsset[]> {
  const rows = await assetsOf(ctx, personaId)
  const ordered = [...rows.filter((row) => row.source === 'operator'), ...rows.filter((row) => row.source === 'producer')]
  return ordered
    .flatMap((row) => {
      const kind = row.kind
      if (!isPlaceable(kind)) return []
      return [{ id: row._id, name: row.name, kind, tags: row.tags, note: row.note }]
    })
    .slice(0, WRITER_ASSETS_MAX)
}

/**
 * The writer's beats with each asset it asked for by name resolved to the
 * asset's id. A name the library does not hold, or an asset on the beat that
 * shows the sponsor (a demo shows the sponsor's own screen), is a problem
 * the writer retries on.
 */
export function placeAssets(
  beats: readonly DraftBeat[],
  assets: readonly WriterAsset[],
  sponsorName: string
): { beats: StoredBeat[]; problems: string[] } {
  const problems: string[] = []
  const placed = beats.map((beat, index): StoredBeat => {
    const { asset, ...rest } = beat
    if (asset === undefined || asset.trim() === '') return rest
    const n = index + 1
    const found = assets.find((candidate) => sameAssetName(candidate.name, asset))
    if (!found) {
      problems.push(`Beat ${n} asks for the asset "${asset}", which is not in your asset library.`)
      return rest
    }
    if (rest.tool.toLowerCase() === sponsorName.toLowerCase()) {
      problems.push(`Beat ${n} shows ${sponsorName} on screen, so it cannot show "${found.name}"; place it in another beat.`)
      return rest
    }
    return { ...rest, assetId: found.id }
  })
  return { beats: placed, problems }
}

/**
 * Where the runner downloads each asset the shots show, and what kind it is.
 * An asset is never removed while a script that may still be recorded shows
 * it (`removeAsset`), so a missing one here is a bug.
 */
export async function shotAssets(
  ctx: { db: QueryCtx['db']; storage: QueryCtx['storage'] },
  shots: readonly Shot[]
): Promise<{ assetId: string; url: string; kind: PlaceableAssetKind }[]> {
  const ids = [...new Set(shots.flatMap((shot) => (shot.kind === 'asset' ? [shot.assetId] : [])))]
  const assets: { assetId: string; url: string; kind: PlaceableAssetKind }[] = []
  for (const id of ids) {
    const assetId = ctx.db.normalizeId('assets', id)
    const asset = assetId === null ? null : await ctx.db.get(assetId)
    if (!asset) throw new Error(`asset ${id} a shot shows is not in the library`)
    const kind = asset.kind
    if (!isPlaceable(kind)) throw new Error(`asset ${id} is ${kind}, which a shot cannot show`)
    const url = await ctx.storage.getUrl(asset.storageId)
    if (url === null) throw new Error(`asset ${id} has no stored file`)
    assets.push({ assetId: id, url, kind })
  }
  return assets
}

/** What the operator gives an upload: a name the writer can ask for, tags, a note. */
interface AssetText {
  name: string
  tags: string[]
  note: string
}

/** The name with its spacing tidied, the tags as the form parses them (shared `parseAssetTags`) and the note trimmed. */
function tidyText(text: AssetText): AssetText {
  return { name: text.name.trim().replace(/\s+/g, ' '), tags: parseAssetTags(text.tags.join(',')), note: text.note.trim() }
}

/** What became of an upload: stored as an asset, or refused with the words the operator reads. */
export type UploadOutcome = { status: 'stored'; assetId: Id<'assets'> } | { status: 'refused'; message: string }

/**
 * Stores the operator's upload as an asset of the persona. The kind comes from
 * the file's own content type, as storage recorded it. A file the library
 * does not take, one too large, or one sent with a name, tags or a note that
 * break the rules is deleted again, so it never sits in storage unnamed. The
 * refusal is returned, not thrown: a thrown error would roll the delete back.
 */
export async function addUploadedAsset(
  ctx: MutationCtx,
  persona: Pick<Doc<'personas'>, '_id'>,
  args: AssetText & { storageId: Id<'_storage'>; now: number }
): Promise<UploadOutcome> {
  const file = await ctx.db.system.get(args.storageId)
  if (!file) return { status: 'refused', message: 'The upload did not arrive; try again.' }
  const contentType = file.contentType ?? ''
  const kind = assetKindOf(contentType)
  const text = tidyText(args)
  const problem = assetFileProblem({ contentType, size: file.size }) ?? assetProblems(text)[0] ?? null
  if (kind === null || problem !== null) {
    await ctx.storage.delete(args.storageId)
    return { status: 'refused', message: problem ?? `The library takes no ${contentType} file.` }
  }
  const assetId = await ctx.db.insert('assets', {
    personaId: persona._id,
    storageId: args.storageId,
    kind,
    ...text,
    contentType,
    size: file.size,
    source: 'operator',
    createdAt: args.now,
  })
  return { status: 'stored', assetId }
}

/** The operator renames an asset, or changes its tags or its note. */
export async function updateAsset(ctx: MutationCtx, assetId: Id<'assets'>, text: AssetText): Promise<void> {
  const asset = await ctx.db.get(assetId)
  if (!asset) throw new Error(`asset ${assetId} not found`)
  const tidy = tidyText(text)
  const [problem] = assetProblems(tidy)
  if (problem !== undefined) throw refusal(problem)
  await ctx.db.patch(asset._id, tidy)
}

/**
 * Whether an episode may still be recorded, so the assets its beats show must
 * stay: every status but the two terminal ones. A published or scheduled
 * episode can fail and be recorded again (shared `EPISODE_TRANSITIONS`).
 */
function mayRecord(status: EpisodeStatus): boolean {
  return status !== 'measured' && status !== 'killed'
}

/**
 * Removes an asset from the library. Refused while a script that may still be
 * recorded shows it (`mayRecord`). Its file goes with it unless an episode's renders are
 * that same file: a render the producer saved stays on its episode, which
 * still publishes it.
 */
export async function removeAsset(ctx: MutationCtx, assetId: Id<'assets'>): Promise<void> {
  const asset = await ctx.db.get(assetId)
  if (!asset) throw new Error(`asset ${assetId} not found`)
  const episodes = await ctx.db
    .query('episodes')
    .withIndex('by_persona', (q) => q.eq('personaId', asset.personaId))
    .collect()
  const showing = episodes.find(
    (episode) => mayRecord(episode.status) && (episode.shotPlan ?? []).some((beat) => beat.assetId === asset._id)
  )
  if (showing)
    throw refusal(
      `"${showing.title}" shows this ${ASSET_KIND_LABELS[asset.kind].toLowerCase()}; it stays until that episode is measured or killed.`
    )
  await ctx.db.delete(asset._id)
  const episode = asset.episodeId === undefined ? null : await ctx.db.get(asset.episodeId)
  if (episode?.renders.some((render) => render.storageId === asset.storageId)) return
  await ctx.storage.delete(asset.storageId)
}

/**
 * What the producer made for an episode goes into the library: each render
 * as a clip, the voice track as audio, an image post's card as an image. A
 * second render of the same episode saves its files again; each is a file of
 * its own.
 */
export async function saveProduced(ctx: MutationCtx, episode: Doc<'episodes'>, result: ProduceResult, now: number): Promise<void> {
  const save = async (storageId: Id<'_storage'>, kind: AssetKind, name: string, tags: string[]) => {
    const file = await ctx.db.system.get(storageId)
    if (!file) throw new Error(`file ${storageId} the runner uploaded is not in storage`)
    await ctx.db.insert('assets', {
      personaId: episode.personaId,
      storageId,
      kind,
      name,
      contentType: file.contentType ?? '',
      size: file.size,
      tags,
      note: '',
      source: 'producer',
      episodeId: episode._id,
      createdAt: now,
    })
  }
  for (const render of result.renders) {
    // The runner's result is a boundary: its ids are the storage ids it uploaded to.
    const storageId = render.storageId as Id<'_storage'>
    if (episode.kind === 'image') await save(storageId, 'image', producedAssetName(episode.title, 'card'), ['post card'])
    else await save(storageId, 'clip', producedAssetName(episode.title, aspectName(render.aspect)), ['render', render.aspect])
  }
  if (result.voiceStorageId !== undefined) {
    await save(result.voiceStorageId as Id<'_storage'>, 'audio', producedAssetName(episode.title, 'voice'), ['voice track'])
  }
}

function aspectName(aspect: AspectRatio): string {
  return aspect === '9:16' ? 'vertical' : 'wide'
}

/**
 * What the assets page reads: the persona's assets, newest first, each with
 * the URL to preview it, the title of the episode the producer made it for,
 * whether that episode's renders are the same file (so `removeAsset` keeps
 * it), and which scripts that may still be recorded show it.
 */
export async function assetsView(
  ctx: { db: QueryCtx['db']; storage: QueryCtx['storage'] },
  persona: Doc<'personas'>
): Promise<(Doc<'assets'> & { url: string | null; episodeTitle: string | null; keptByEpisode: boolean; shownIn: string[] })[]> {
  const rows = await assetsOf(ctx, persona._id)
  const episodes = await ctx.db
    .query('episodes')
    .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
    .collect()
  const view = []
  for (const row of rows) {
    const episode = row.episodeId === undefined ? undefined : episodes.find((candidate) => candidate._id === row.episodeId)
    const shownIn = episodes
      .filter((candidate) => mayRecord(candidate.status) && (candidate.shotPlan ?? []).some((beat) => beat.assetId === row._id))
      .map((candidate) => candidate.title)
    view.push({
      ...row,
      url: await ctx.storage.getUrl(row.storageId),
      episodeTitle: episode?.title ?? null,
      keptByEpisode: episode?.renders.some((render) => render.storageId === row.storageId) ?? false,
      shownIn,
    })
  }
  return view
}
