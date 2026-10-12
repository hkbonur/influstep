import { providersMode } from '../../lib/env'
import { anthropicLlm } from './anthropic'
import { mockLlm } from './mock'
import type { LlmProvider } from './types'

export function llmProvider(): LlmProvider {
  return providersMode() === 'real' ? anthropicLlm : mockLlm
}
export { PRESENTER_TOOL } from './types'
export type { ScriptBrief, ScriptDraft, ChatTurn } from './types'
