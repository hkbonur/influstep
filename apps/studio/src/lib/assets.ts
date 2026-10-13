import { ASSET_KINDS, ASSET_KIND_LABELS, type AssetKind } from '@influstep/shared'
import { plural } from './format'

/** How many of each kind a persona's library holds, in the order of the kinds: "1 image, 2 clips, 1 audio". */
export function assetCounts(assets: { kind: AssetKind }[]): string {
  if (assets.length === 0) return 'No assets yet'
  return ASSET_KINDS.flatMap((kind) => {
    const n = assets.filter((asset) => asset.kind === kind).length
    if (n === 0) return []
    const label = ASSET_KIND_LABELS[kind].toLowerCase()
    // Audio counts like a mass noun: "2 audio", not "2 audios".
    return [`${n} ${plural(n, label, kind === 'audio' ? label : `${label}s`)}`]
  }).join(', ')
}
