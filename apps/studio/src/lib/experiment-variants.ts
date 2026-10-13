import type { api } from '@influstep/convex/_generated/api'
import { EXPERIMENT_CATALOG, effectiveVariant, type ExperimentKind, type StrategyDefault } from '@influstep/shared'
import type { FunctionArgs } from 'convex/server'

/** A variant as the new experiment form sends it: the backend's own validator, read from the mutation. */
export type VariantInput = FunctionArgs<typeof api.private.experiments.create>['variants'][number]

/**
 * A variant the form already knows for a dimension. A line that names it keeps
 * its key, its length factor (a length variant) and its hour offset (a publish
 * time variant), which the operator's line has no way to say.
 */
export type KnownVariant = Omit<VariantInput, 'isControl'>

/** The numbers a known variant carries beside its words: only the ones it has, so none is sent as undefined. */
function numbersOf(variant: { lengthFactor?: number; hourOffset?: number }): Pick<KnownVariant, 'lengthFactor' | 'hourOffset'> {
  const numbers: Pick<KnownVariant, 'lengthFactor' | 'hourOffset'> = {}
  if (variant.lengthFactor !== undefined) numbers.lengthFactor = variant.lengthFactor
  if (variant.hourOffset !== undefined) numbers.hourOffset = variant.hourOffset
  return numbers
}

function known(variant: { key: string; label: string; description: string; lengthFactor?: number; hourOffset?: number }): KnownVariant {
  return { key: variant.key, label: variant.label, description: variant.description, ...numbersOf(variant) }
}

/**
 * The variants the form fills in for a dimension: what the persona does now on
 * it first, since that is the control (the persona's default, or the catalog's
 * control when it has none), then the rest of the catalog in its order.
 */
export function knownVariants(kind: ExperimentKind, defaults: StrategyDefault[] | undefined): KnownVariant[] {
  const inForce = effectiveVariant(kind, {}, defaults)
  const others = EXPERIMENT_CATALOG[kind].filter((variant) => variant.key !== inForce.key)
  return [known(inForce), ...others.map(known)]
}

/** The variants as the form's text: one "Label: what the writer does" line each. */
export function variantsText(variants: readonly KnownVariant[]): string {
  return variants.map((variant) => `${variant.label}: ${variant.description}`).join('\n')
}

/** A label the operator made up, as a key: lower case, runs of anything else as one hyphen. */
function slugKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

/**
 * The form's text as variants, the first line the control. A label that names
 * a known variant (case aside) keeps that variant's key, length factor and hour
 * offset, so the analyst's learnings, the persona's defaults, the writer and the
 * publish hour recognize it; its description is the operator's, edited or not.
 * Any other label is a new variant keyed by its words.
 */
export function parseVariants(text: string, knownList: readonly KnownVariant[]): VariantInput[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const colon = line.indexOf(':')
      const label = (colon === -1 ? line : line.slice(0, colon)).trim()
      const description = colon === -1 ? '' : line.slice(colon + 1).trim()
      const isControl = index === 0
      const match = knownList.find((variant) => variant.label.toLowerCase() === label.toLowerCase())
      if (match === undefined) return { key: slugKey(label), label, description, isControl }
      return { key: match.key, label, description, isControl, ...numbersOf(match) }
    })
}
