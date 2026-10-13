import { providersMode } from '../../lib/env'
import { anthropicLlm } from './anthropic'
import { mockLlm } from './mock'
import type { LlmProvider } from './types'

export function llmProvider(): LlmProvider {
  return providersMode() === 'real' ? anthropicLlm : mockLlm
}
export { POST_LENGTH_TARGETS, PRESENTER_TOOL } from './types'
export type {
  AccountPostSample,
  ScriptBrief,
  ScriptDraft,
  PostBrief,
  PostDraft,
  VoiceBrief,
  VoiceDraft,
  ChatTurn,
  PlanRow,
  TaskReportArgs,
  TaskSignal,
} from './types'
