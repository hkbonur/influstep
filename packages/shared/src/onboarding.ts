/**
 * Onboarding (docs/plan.md, slice 13): the first-run flow that builds the
 * roster, one step per persona, and adds one more persona later. The writer
 * proposes a persona from its niche and audience; the operator edits the
 * proposal in place before it is created.
 */

/** How many personas the first run builds at most; more are added one at a time. */
export const ONBOARDING_PERSONAS_MAX = 5

/** A persona's handle: the same on every platform and the tracked links' utm_source. */
export const HANDLE_PATTERN = /^[a-z0-9._-]{3,30}$/

export const PILLARS_MIN = 3
export const PILLARS_MAX = 5

/** What the writer proposes for a new persona, and what the operator edits before creating it. */
export interface PersonaProposal {
  name: string
  handle: string
  tone: string
  pillars: string[]
  bio: string
  bible: string
}

/** A handle from a name: lower case, words joined by dots, only what a handle may hold. */
export function handleFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 30)
}

/**
 * The handle, or the first of handle2, handle3, … no persona has. A proposal
 * never names a handle that is taken, so the operator does not meet the
 * refusal for one the writer chose.
 */
export function freeHandle(handle: string, taken: readonly string[]): string {
  if (!taken.includes(handle)) return handle
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${handle.slice(0, 30 - String(suffix).length)}${suffix}`
    if (!taken.includes(candidate)) return candidate
  }
}

/** Pillars as the operator types them: comma separated, trimmed, empty ones dropped. */
export function parsePillars(text: string): string[] {
  return text
    .split(',')
    .map((pillar) => pillar.trim())
    .filter((pillar) => pillar.length > 0)
}

/** Everything wrong with a persona before it is created, in the operator's words; none when it can be created. */
export function proposalProblems(
  proposal: PersonaProposal & { niche: string; audience: string },
  takenHandles: readonly string[]
): string[] {
  const problems: string[] = []
  if (proposal.niche.trim().length === 0) problems.push('Say what the persona is about: its niche.')
  if (proposal.audience.trim().length === 0) problems.push('Say who the persona talks to: its audience.')
  if (proposal.name.trim().length === 0) problems.push('The persona needs a name.')
  if (!HANDLE_PATTERN.test(proposal.handle)) problems.push('A handle is 3 to 30 lower-case letters, digits, dots, dashes or underscores.')
  else if (takenHandles.includes(proposal.handle)) problems.push(`The handle ${proposal.handle} is taken.`)
  if (proposal.tone.trim().length === 0) problems.push('Describe the tone in a few words.')
  if (proposal.pillars.length < PILLARS_MIN || proposal.pillars.length > PILLARS_MAX)
    problems.push(`Give ${PILLARS_MIN} to ${PILLARS_MAX} content pillars, comma separated.`)
  if (new Set(proposal.pillars.map((pillar) => pillar.toLowerCase())).size < proposal.pillars.length)
    problems.push('Each content pillar is named once.')
  if (proposal.bio.trim().length === 0) problems.push('The persona needs a bio.')
  if (proposal.bible.trim().length === 0) problems.push('The bible says how the persona speaks and what it never says.')
  return problems
}
