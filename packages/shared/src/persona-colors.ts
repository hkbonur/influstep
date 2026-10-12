/**
 * A persona's identity color: the hue its avatar is drawn in, so the operator
 * tells personas apart at a glance. It names who a persona is, never what
 * state it is in. Ink is Formstep's own mascot color.
 */
export const PERSONA_COLORS = ['ink', 'plum', 'violet', 'iris', 'teal', 'olive', 'clay', 'rose'] as const
export type PersonaColor = (typeof PERSONA_COLORS)[number]

export const PERSONA_COLOR_LABELS: Record<PersonaColor, string> = {
  ink: 'Ink',
  plum: 'Plum',
  violet: 'Violet',
  iris: 'Iris',
  teal: 'Teal',
  olive: 'Olive',
  clay: 'Clay',
  rose: 'Rose',
}

/**
 * The color a new persona starts with: the first one no persona wears yet.
 * Once all eight are worn, the colors repeat in order by roster size, so the
 * ninth persona gets ink again and the tenth plum.
 */
export function firstUnusedPersonaColor(used: PersonaColor[]): PersonaColor {
  const worn = new Set(used)
  const unused = PERSONA_COLORS.find((color) => !worn.has(color))
  if (unused) return unused
  return PERSONA_COLORS[used.length % PERSONA_COLORS.length]
}
