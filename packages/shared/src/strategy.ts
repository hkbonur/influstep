import { EXPERIMENT_KINDS, EXPERIMENT_KIND_LABELS, catalogControl, type ExperimentKind } from './experiments'
import type { Weekday } from './chat'
import type { SponsorSegment } from './episode-status'

/**
 * A persona's strategy (docs/plan.md, v0.2 item 8): what it does by default on
 * each experiment dimension, the journal of every change the strategy review
 * or the operator made, and the learnings the writer reads.
 */

/**
 * What the persona does on one dimension since an experiment decided it: the
 * winning variant, and the experiment it came from. A dimension with no
 * default does what the catalog's control says.
 */
export interface StrategyDefault {
  kind: ExperimentKind
  key: string
  label: string
  description: string
  lengthFactor?: number
  experimentId?: string
  /** When it became the default. */
  since: number
}

/**
 * When the weekly strategy review runs, in UTC: Mondays at 06:30, half an
 * hour before the week is planned, so the plan follows the fresh strategy.
 * The cron schedules it from here and the studio's "next review" line reads it.
 */
export const STRATEGY_REVIEW_SLOT = { dayOfWeek: 'monday', hourUTC: 6, minuteUTC: 30 } as const satisfies {
  dayOfWeek: Weekday
  hourUTC: number
  minuteUTC: number
}

export const JOURNAL_KINDS = ['pillar_weights', 'publish_hour', 'experiment_started', 'experiment_decided', 'experiment_stopped'] as const
export type JournalKind = (typeof JOURNAL_KINDS)[number]

export const JOURNAL_KIND_LABELS: Record<JournalKind, string> = {
  pillar_weights: 'Pillar weights',
  publish_hour: 'Publish hour',
  experiment_started: 'Experiment started',
  experiment_decided: 'Experiment decided',
  experiment_stopped: 'Experiment stopped',
}

/** Who made a change: the persona's analyst on its own, or the operator. Also who set an experiment up. */
export const JOURNAL_ACTORS = ['analyst', 'operator'] as const
export type JournalActor = (typeof JOURNAL_ACTORS)[number]

/** What a memory entry is. Slice 10 adds fact, rule and goal note. */
export const MEMORY_KINDS = ['learning'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

/** A superseded memory stays, so the persona can show why it once believed it. */
export const MEMORY_STATUSES = ['active', 'superseded'] as const
export type MemoryStatus = (typeof MEMORY_STATUSES)[number]

/** What an episode does on one dimension, and whether that is what the persona did before it tested anything. */
export interface EffectiveVariant {
  kind: ExperimentKind
  key: string
  label: string
  description: string
  lengthFactor?: number
  isControl: boolean
}

/** An episode as the style rules read it: the variant it carries, with the dimension its experiment varies. */
export interface StyledEpisode {
  variant?: { kind: ExperimentKind; key: string; label: string; description: string; lengthFactor?: number }
  /** An unsponsored episode places no sponsor, so a sponsor default or variant says nothing about it. */
  sponsorSegment?: SponsorSegment
}

function resolved(kind: ExperimentKind, variant: Omit<EffectiveVariant, 'kind' | 'isControl'>): EffectiveVariant {
  const out: EffectiveVariant = {
    kind,
    key: variant.key,
    label: variant.label,
    description: variant.description,
    isControl: variant.key === catalogControl(kind).key,
  }
  if (variant.lengthFactor !== undefined) out.lengthFactor = variant.lengthFactor
  return out
}

/**
 * The one rule for what an episode does on a dimension: its own variant when
 * its experiment varies that dimension, else the persona's default for it,
 * else the catalog's control. Style lines, the mock writer's hook and closing
 * line, the stored format's length and the writer's length all read it.
 */
export function effectiveVariant(
  kind: ExperimentKind,
  episode: StyledEpisode,
  defaults: readonly StrategyDefault[] | undefined
): EffectiveVariant {
  if (kind === 'sponsor' && episode.sponsorSegment === 'none') return resolved(kind, catalogControl(kind))
  if (episode.variant && episode.variant.kind === kind) return resolved(kind, episode.variant)
  const inForce = defaults?.find((entry) => entry.kind === kind)
  if (inForce) return resolved(kind, inForce)
  return resolved(kind, catalogControl(kind))
}

/** `effectiveVariant` on every dimension. */
export function effectiveStyle(
  episode: StyledEpisode,
  defaults: readonly StrategyDefault[] | undefined
): Record<ExperimentKind, EffectiveVariant> {
  return {
    hook: effectiveVariant('hook', episode, defaults),
    concept: effectiveVariant('concept', episode, defaults),
    sponsor: effectiveVariant('sponsor', episode, defaults),
    length: effectiveVariant('length', episode, defaults),
    cta: effectiveVariant('cta', episode, defaults),
  }
}

/**
 * The writer's lines for the style in force: "<Dimension>: <what to do>" for
 * every dimension that is not the control, skipping the one the episode's own
 * experiment varies, whose variant line says it.
 */
export function styleLines(style: Record<ExperimentKind, EffectiveVariant>, variantKind?: ExperimentKind): string[] {
  return EXPERIMENT_KINDS.flatMap((kind) => {
    const variant = style[kind]
    if (variant.isControl) return []
    if (kind === variantKind) return []
    return [`${EXPERIMENT_KIND_LABELS[kind]}: ${variant.description}`]
  })
}
