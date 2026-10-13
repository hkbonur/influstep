/**
 * A persona's asset library (docs/plan.md, v0.2 item 10): files in Convex
 * storage the operator uploads or the producer saves, each with tags and a
 * note. The writer can place an image or a clip in a beat, and the producer
 * shows it in place of the beat's screen.
 */

export const ASSET_KINDS = ['image', 'clip', 'audio', 'document'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  image: 'Image',
  clip: 'Clip',
  audio: 'Audio',
  document: 'Document',
}

/** What a beat can show: a still or a moving picture. Audio and documents stay in the library. */
export const PLACEABLE_ASSET_KINDS = ['image', 'clip'] as const satisfies readonly AssetKind[]
export type PlaceableAssetKind = (typeof PLACEABLE_ASSET_KINDS)[number]

export function isPlaceable(kind: AssetKind): kind is PlaceableAssetKind {
  return kind === 'image' || kind === 'clip'
}

/** Who put an asset in the library: the operator uploaded it, or the producer saved what it made. */
export const ASSET_SOURCES = ['operator', 'producer'] as const
export type AssetSource = (typeof ASSET_SOURCES)[number]

/** The largest file the operator can upload, in bytes. */
export const ASSET_MAX_BYTES = 100 * 1024 * 1024
export const ASSET_NAME_MAX = 80
export const ASSET_NOTE_MAX = 280
export const ASSET_TAGS_MAX = 8
export const ASSET_TAG_MAX = 32

/** The kind a file is by its content type, or null for a type the library does not take. */
export function assetKindOf(contentType: string): AssetKind | null {
  const type = contentType.toLowerCase().split(';')[0]?.trim() ?? ''
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'clip'
  if (type.startsWith('audio/')) return 'audio'
  if (type === 'application/pdf' || type.startsWith('text/')) return 'document'
  return null
}

/** What keeps a file out of the library: a type it does not take, or a size over the limit; null when it fits. */
export function assetFileProblem(file: { contentType: string; size: number }): string | null {
  if (assetKindOf(file.contentType) === null)
    return `The library takes images, clips, audio, PDFs and text; this file is ${file.contentType === '' ? 'of no known type' : file.contentType}.`
  if (file.size > ASSET_MAX_BYTES) return `Keep a file under ${megabytes(ASSET_MAX_BYTES)} MB; this one is ${megabytes(file.size)} MB.`
  return null
}

/** A size in megabytes, to one decimal where it has one. */
export function megabytes(bytes: number): string {
  const value = bytes / 1024 / 1024
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/**
 * The tags the operator typed, comma separated: trimmed, lowercased, without
 * a leading "#", each once, in the order typed.
 */
export function parseAssetTags(text: string): string[] {
  const tags: string[] = []
  for (const raw of text.split(',')) {
    const tag = raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase()
    if (tag !== '' && !tags.includes(tag)) tags.push(tag)
  }
  return tags
}

/** What is wrong with an asset's name, tags and note, in the order the form shows them; empty when nothing is. */
export function assetProblems(asset: { name: string; tags: string[]; note: string }): string[] {
  const problems: string[] = []
  const name = asset.name.trim()
  if (name === '') problems.push('Give the asset a name the writer can ask for.')
  if (name.length > ASSET_NAME_MAX) problems.push(`Keep the name to ${ASSET_NAME_MAX} characters; this is ${name.length}.`)
  if (asset.tags.length > ASSET_TAGS_MAX) problems.push(`Keep it to ${ASSET_TAGS_MAX} tags; this has ${asset.tags.length}.`)
  const long = asset.tags.find((tag) => tag.length > ASSET_TAG_MAX)
  if (long !== undefined) problems.push(`Keep each tag to ${ASSET_TAG_MAX} characters; "${long}" is ${long.length}.`)
  const note = asset.note.trim()
  if (note.length > ASSET_NOTE_MAX) problems.push(`Keep the note to ${ASSET_NOTE_MAX} characters; this is ${note.length}.`)
  return problems
}

/** A file's name as an asset's: without its extension, and with dashes and underscores as spaces. */
export function assetNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^./]+$/, '')
  return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The name the producer saves a render or a voice track under: the episode's
 * title and what the file is, the title cut short with an ellipsis when both
 * would not fit the name limit, so the operator can edit the asset as saved.
 */
export function producedAssetName(title: string, what: string): string {
  const suffix = ` (${what})`
  const room = ASSET_NAME_MAX - suffix.length
  const trimmed = title.trim()
  if (trimmed.length <= room) return `${trimmed}${suffix}`
  return `${trimmed.slice(0, room - 1).trimEnd()}…${suffix}`
}

/** Whether the writer's words name this asset: its name, ignoring case and spacing. */
export function sameAssetName(a: string, b: string): boolean {
  const norm = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()
  return norm(a) === norm(b)
}
