export const CHECKLIST_STATUSES = ['open', 'done'] as const
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number]

/**
 * The provider key the X publisher reads once the adapter exists. The X
 * connect checklist item asks for it, and the voice page finds that item by it.
 */
export const X_PROVIDER_KEY = 'X_OAUTH'

export const DIRECTIVE_VERBS = ['focus', 'stop', 'always', 'never', 'more', 'less', 'try'] as const

/**
 * A chat message becomes a directive when it reads like an instruction: it
 * opens with one of the directive verbs or addresses the persona with "you
 * should". Everything else is conversation.
 */
export function readsAsDirective(text: string): boolean {
  const trimmed = text.trim().toLowerCase()
  if (trimmed.length < 8) return false
  if (/^(please\s+)?(from now on|you should|i want you to|make sure)/.test(trimmed)) return true
  return DIRECTIVE_VERBS.some((verb) => trimmed.startsWith(`${verb} `))
}
