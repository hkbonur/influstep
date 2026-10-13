import { describe, expect, it } from 'vitest'
import {
  ASSET_MAX_BYTES,
  ASSET_NAME_MAX,
  assetFileProblem,
  assetKindOf,
  assetNameFromFile,
  assetProblems,
  megabytes,
  parseAssetTags,
  producedAssetName,
  sameAssetName,
} from './assets'

describe('assetKindOf', () => {
  it('reads the kind from the content type, and takes nothing it cannot show or keep', () => {
    expect(assetKindOf('image/png')).toBe('image')
    expect(assetKindOf('video/mp4')).toBe('clip')
    expect(assetKindOf('audio/mp4')).toBe('audio')
    expect(assetKindOf('application/pdf')).toBe('document')
    expect(assetKindOf('text/plain; charset=utf-8')).toBe('document')
    expect(assetKindOf('application/zip')).toBeNull()
  })
})

describe('assetFileProblem', () => {
  it('refuses a type the library does not take and a file over the limit, in megabytes', () => {
    expect(assetFileProblem({ contentType: 'application/zip', size: 10 })).toBe(
      'The library takes images, clips, audio, PDFs and text; this file is application/zip.'
    )
    expect(assetFileProblem({ contentType: '', size: 10 })).toBe(
      'The library takes images, clips, audio, PDFs and text; this file is of no known type.'
    )
    expect(assetFileProblem({ contentType: 'video/mp4', size: ASSET_MAX_BYTES + 200 * 1024 })).toBe(
      'Keep a file under 100 MB; this one is 100.2 MB.'
    )
    expect(assetFileProblem({ contentType: 'video/mp4', size: ASSET_MAX_BYTES })).toBeNull()
    expect(megabytes(3 * 1024 * 1024)).toBe('3')
  })
})

describe('parseAssetTags', () => {
  it('splits on commas, trims, lowercases, drops a leading hash and repeats', () => {
    expect(parseAssetTags(' Pricing, #screenshot,,pricing ,  Formstep  page ')).toEqual(['pricing', 'screenshot', 'formstep page'])
  })
})

describe('assetProblems', () => {
  it('asks for a name and keeps the name, the tags and the note short', () => {
    expect(assetProblems({ name: ' ', tags: [], note: '' })).toEqual(['Give the asset a name the writer can ask for.'])
    expect(
      assetProblems({ name: 'x'.repeat(ASSET_NAME_MAX + 1), tags: Array.from({ length: 9 }, (_, index) => `tag ${index}`), note: '' })
    ).toEqual([`Keep the name to ${ASSET_NAME_MAX} characters; this is ${ASSET_NAME_MAX + 1}.`, 'Keep it to 8 tags; this has 9.'])
    expect(assetProblems({ name: 'Pricing page', tags: ['pricing'], note: 'The plans as of October.' })).toEqual([])
  })
})

describe('asset names', () => {
  it('names an upload after its file, and matches a name whatever its case and spacing', () => {
    expect(assetNameFromFile('pricing-page_october.png')).toBe('pricing page october')
    expect(sameAssetName('Pricing  page', 'pricing page')).toBe(true)
    expect(sameAssetName('Pricing page', 'Pricing')).toBe(false)
  })

  it('names what the producer made after its episode, cutting a long title so the name stays editable', () => {
    expect(producedAssetName('Error workflows that page you only once', 'wide')).toBe('Error workflows that page you only once (wide)')
    const long = 'n8n queue mode for webhooks: is it worth turning on? (Automation fails) and more'
    const name = producedAssetName(long, 'vertical')
    expect(name).toHaveLength(ASSET_NAME_MAX)
    expect(name.endsWith('… (vertical)')).toBe(true)
    expect(assetProblems({ name, tags: [], note: '' })).toEqual([])
  })
})
