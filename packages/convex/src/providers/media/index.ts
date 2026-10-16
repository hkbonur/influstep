import { providersMode } from '../../lib/env'
import { mockMedia } from './mock'
import { realMedia } from './real'
import type { MediaProvider } from './types'

export function mediaProvider(): MediaProvider {
  return providersMode() === 'real' ? realMedia : mockMedia
}
