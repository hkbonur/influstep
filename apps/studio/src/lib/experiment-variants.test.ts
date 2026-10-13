import { EXPERIMENT_CATALOG, type StrategyDefault } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { knownVariants, parseVariants, variantsText } from './experiment-variants'

describe('knownVariants', () => {
  it('fills in the catalog, control first, when the persona has no default', () => {
    expect(knownVariants('hook', undefined).map((variant) => variant.key)).toEqual(EXPERIMENT_CATALOG.hook.map((variant) => variant.key))
  })
  it('puts the default in force first, as the control, and lists it once', () => {
    const comment = EXPERIMENT_CATALOG.cta.find((variant) => variant.key === 'comment')
    if (comment === undefined) throw new Error('the catalog has no comment call to action')
    const defaults: StrategyDefault[] = [
      { kind: 'cta', key: comment.key, label: comment.label, description: comment.description, since: 0 },
    ]
    expect(knownVariants('cta', defaults).map((variant) => variant.key)).toEqual(['comment', 'follow', 'link'])
  })
  it('carries the length factor of a length variant', () => {
    expect(knownVariants('length', undefined).map((variant) => variant.lengthFactor)).toEqual([1, 0.7, 1.3])
  })
  it('carries the hour offset of a publish time variant', () => {
    expect(knownVariants('publish_time', undefined).map((variant) => variant.hourOffset)).toEqual([0, -3, 3])
  })
})

describe('parseVariants', () => {
  it('reads the filled-in text back as the same variants, the first the control', () => {
    const known = knownVariants('length', undefined)
    const parsed = parseVariants(variantsText(known), known)
    expect(parsed.map((variant) => variant.key)).toEqual(['standard', 'shorter', 'longer'])
    expect(parsed.map((variant) => variant.isControl)).toEqual([true, false, false])
    expect(parsed[1]?.lengthFactor).toBe(0.7)
  })
  it('keeps a known key when the label differs only in case and the description was edited', () => {
    const known = knownVariants('hook', undefined)
    const howTo = known[0]
    if (howTo === undefined) throw new Error('the hook catalog is empty')
    const [parsed] = parseVariants(`${howTo.label.toUpperCase()}: say what they will build`, known)
    expect(parsed).toEqual({ key: howTo.key, label: howTo.label.toUpperCase(), description: 'say what they will build', isControl: true })
  })
  it('keys a new label by its words and skips blank lines', () => {
    const parsed = parseVariants('\n  Cold open: start mid-action \n\nNo colon here', [])
    expect(parsed).toEqual([
      { key: 'cold-open', label: 'Cold open', description: 'start mid-action', isControl: true },
      { key: 'no-colon-here', label: 'No colon here', description: '', isControl: false },
    ])
  })
  it('keeps the hour offset of a known publish time variant, which the line cannot say', () => {
    const known = [
      { key: 'usual', label: 'Usual hour', description: "Publish at the platform's usual hour.", hourOffset: 0 },
      {
        key: 'earlier',
        label: 'Three hours earlier',
        description: "Publish three hours before the platform's usual hour.",
        hourOffset: -3,
      },
    ]
    expect(parseVariants('Usual hour: as before\nthree hours earlier: before lunch', known)).toEqual([
      { key: 'usual', label: 'Usual hour', description: 'as before', isControl: true, hourOffset: 0 },
      { key: 'earlier', label: 'three hours earlier', description: 'before lunch', isControl: false, hourOffset: -3 },
    ])
  })
  it('splits on the first colon only, so a description may hold one', () => {
    const [parsed] = parseVariants('Number: open with a count: "3 things"', [])
    expect(parsed?.description).toBe('open with a count: "3 things"')
  })
})
