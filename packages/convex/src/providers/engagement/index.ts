import { providersMode } from '../../lib/env'
import { mockEngagement } from './mock'
import type { EngagementProvider } from './types'
import { xEngagement } from './x'

export function engagementProvider(): EngagementProvider {
  return providersMode() === 'real' ? xEngagement : mockEngagement
}

export { X_LISTENING_NEEDS_SEARCH } from './types'
