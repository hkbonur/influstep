import { describe, expect, it } from 'vitest'
import { heygenTakeBody, shotStarts } from './avatar'

describe('shotStarts', () => {
  it('starts each shot where the spoken length of the ones before it ends', () => {
    const twelve = Array.from({ length: 12 }, () => 'word').join(' ')
    expect(shotStarts([{ voiceover: twelve }, { voiceover: 'one two' }, { voiceover: twelve }])).toEqual([0, 5, 7])
  })
})

describe('heygenTakeBody', () => {
  it('animates the uploaded portrait to our own audio, square', () => {
    expect(heygenTakeBody({ imageAssetId: 'img', audioAssetId: 'aud', title: 'Hook' })).toEqual({
      type: 'image',
      image: { type: 'asset_id', asset_id: 'img' },
      audio_asset_id: 'aud',
      aspect_ratio: '1:1',
      resolution: '720p',
      expressiveness: 'medium',
      title: 'Hook',
    })
  })
})
