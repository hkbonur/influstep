import { providersMode } from '../../lib/env'
import { mockTimeline } from './mock'
import type { TimelineProvider } from './types'
import { xTimeline } from './x'

export function timelineProvider(): TimelineProvider {
  return providersMode() === 'real' ? xTimeline : mockTimeline
}

export { MOCK_HISTORY_SIZE, mockXHistory } from './mock'
export { X_TIMELINE_NEEDS_OAUTH, type TimelineQuery } from './types'
