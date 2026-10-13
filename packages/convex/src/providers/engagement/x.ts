import { refusal } from '../../lib/errors'
import { X_LISTENING_NEEDS_SEARCH, X_REPLY_COUNTS_NEED_OAUTH, type EngagementProvider } from './types'

/**
 * The X API v2 recent search, mentions and post metrics, once the X adapter
 * exists. Until then real mode refuses by name instead of serving mock posts
 * as if X had said them (ADR 0002).
 */
export const xEngagement: EngagementProvider = {
  name: 'x',
  async listen() {
    throw refusal(X_LISTENING_NEEDS_SEARCH)
  },
  async counts() {
    throw refusal(X_REPLY_COUNTS_NEED_OAUTH)
  },
}
