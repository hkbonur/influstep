import { refusal } from '../../lib/errors'
import { X_TIMELINE_NEEDS_OAUTH, type TimelineProvider } from './types'

/**
 * The X API v2 user timeline, once the X adapter exists. Until then real
 * mode refuses by name instead of serving mock history as if it were the
 * account's (ADR 0002).
 */
export const xTimeline: TimelineProvider = {
  name: 'x',
  async history() {
    throw refusal(X_TIMELINE_NEEDS_OAUTH)
  },
}
