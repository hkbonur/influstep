import { describe, expect, it } from 'vitest'
import type { Id } from '../_generated/dataModel'
import type { DraftBeat } from '../providers/llm/types'
import { placeAssets, type WriterAsset } from './assets'

const SPONSOR = 'Formstep'

function asset(id: string, name: string): WriterAsset {
  return { id: id as Id<'assets'>, name, kind: 'image', tags: [], note: '' }
}

const BEATS: DraftBeat[] = [
  { title: 'The hook', voiceover: 'Your webhook fails silently.', tool: 'presenter', url: '' },
  { title: 'The fix', voiceover: 'Set an error workflow.', tool: 'n8n', url: 'http://localhost:5678', asset: 'error workflow  CANVAS' },
  { title: 'Formstep demo', voiceover: 'Formstep collects it.', tool: SPONSOR, url: 'https://formstep.io' },
]

describe('placing assets', () => {
  it('resolves the name the writer asked for, ignoring case and spacing, to the first asset of that name', () => {
    const placed = placeAssets(BEATS, [asset('a1', 'Error workflow canvas'), asset('a2', 'error workflow canvas')], SPONSOR)
    expect(placed.problems).toEqual([])
    expect(placed.beats.map((beat) => beat.assetId)).toEqual([undefined, 'a1', undefined])
    // The name the writer used is not stored: the beat holds the asset's id.
    expect(placed.beats[1]).not.toHaveProperty('asset')
  })

  it('names an asset the library does not hold, and one asked for on the sponsor beat', () => {
    const beats: DraftBeat[] = BEATS.map((beat, index) => (index === 2 ? { ...beat, asset: 'Pricing page' } : beat))
    const placed = placeAssets(beats, [asset('a1', 'Pricing page')], SPONSOR)
    expect(placed.problems).toEqual([
      'Beat 2 asks for the asset "error workflow  CANVAS", which is not in your asset library.',
      'Beat 3 shows Formstep on screen, so it cannot show "Pricing page"; place it in another beat.',
    ])
    expect(placed.beats.every((beat) => beat.assetId === undefined)).toBe(true)
  })

  it('takes an empty asset as none', () => {
    const placed = placeAssets([{ ...BEATS[0]!, asset: ' ' }], [], SPONSOR)
    expect(placed).toEqual({
      beats: [{ title: 'The hook', voiceover: 'Your webhook fails silently.', tool: 'presenter', url: '' }],
      problems: [],
    })
  })
})
