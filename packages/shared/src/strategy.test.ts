import { describe, expect, it } from 'vitest'
import { EXPERIMENT_CATALOG } from './experiments'
import { effectiveStyle, effectiveVariant, styleLines, type StrategyDefault } from './strategy'

const comment = EXPERIMENT_CATALOG.cta[1]
const early = EXPERIMENT_CATALOG.sponsor[1]
const shorter = EXPERIMENT_CATALOG.length[1]

const defaults: StrategyDefault[] = [
  { kind: 'cta', key: comment.key, label: comment.label, description: comment.description, experimentId: 'e1', since: 1 },
  { kind: 'sponsor', key: early.key, label: early.label, description: early.description, experimentId: 'e2', since: 2 },
]

describe('effectiveVariant', () => {
  it('is the catalog control without a variant or a default', () => {
    expect(effectiveVariant('hook', {}, undefined)).toEqual({
      kind: 'hook',
      key: 'howto',
      label: 'How to',
      description: EXPERIMENT_CATALOG.hook[0].description,
      isControl: true,
    })
    expect(effectiveVariant('length', {}, [])).toMatchObject({ key: 'standard', lengthFactor: 1, isControl: true })
  })

  it('is the persona’s default when the episode’s experiment varies another dimension', () => {
    const wrong = EXPERIMENT_CATALOG.hook[2]
    const episode = { variant: { kind: 'hook' as const, ...wrong } }
    expect(effectiveVariant('cta', episode, defaults)).toMatchObject({ key: 'comment', isControl: false })
  })

  it('is the episode’s own variant on the dimension its experiment varies, even over a default', () => {
    const follow = EXPERIMENT_CATALOG.cta[0]
    expect(effectiveVariant('cta', { variant: { kind: 'cta', ...follow } }, defaults)).toMatchObject({ key: 'follow', isControl: true })
    expect(effectiveVariant('length', { variant: { kind: 'length', ...shorter } }, defaults)).toMatchObject({
      key: 'shorter',
      lengthFactor: 0.7,
      isControl: false,
    })
  })

  it('places no sponsor style on an unsponsored episode', () => {
    expect(effectiveVariant('sponsor', { sponsorSegment: 'none' }, defaults)).toMatchObject({ key: 'end', isControl: true })
    expect(effectiveVariant('sponsor', { sponsorSegment: 'none', variant: { kind: 'sponsor', ...early } }, defaults)).toMatchObject({
      key: 'end',
    })
    expect(effectiveVariant('sponsor', { sponsorSegment: 'mention' }, defaults)).toMatchObject({ key: 'early', isControl: false })
  })
})

describe('styleLines', () => {
  it('says what to do on every dimension that is not the control', () => {
    const style = effectiveStyle({ sponsorSegment: 'mention' }, defaults)
    expect(styleLines(style)).toEqual([`Sponsor placement: ${early.description}`, `Call to action: ${comment.description}`])
  })

  it('is empty when every dimension is the control', () => {
    expect(styleLines(effectiveStyle({}, undefined))).toEqual([])
  })

  it('skips the dimension the episode’s experiment varies, whose variant line says it', () => {
    const style = effectiveStyle({ variant: { kind: 'length', ...shorter } }, defaults)
    expect(styleLines(style, 'length')).toEqual([`Sponsor placement: ${early.description}`, `Call to action: ${comment.description}`])
    expect(styleLines(style)).toContain(`Episode length: ${shorter.description}`)
  })

  it('never says the publish time or the description format, which the script does not carry', () => {
    const later = EXPERIMENT_CATALOG.publish_time[2]
    const code = EXPERIMENT_CATALOG.description_format[1]
    const withNonScript: StrategyDefault[] = [
      ...defaults,
      { kind: 'description_format', key: code.key, label: code.label, description: code.description, experimentId: 'e3', since: 3 },
    ]
    const style = effectiveStyle({ sponsorSegment: 'mention', variant: { kind: 'publish_time', ...later } }, withNonScript)
    expect(style.publish_time).toMatchObject({ key: 'later', hourOffset: 3, isControl: false })
    expect(style.description_format).toMatchObject({ key: 'code', isControl: false })
    expect(styleLines(style)).toEqual([`Sponsor placement: ${early.description}`, `Call to action: ${comment.description}`])
    expect(styleLines(style, 'publish_time')).toEqual([`Sponsor placement: ${early.description}`, `Call to action: ${comment.description}`])
  })
})

describe('effectiveVariant on publish time', () => {
  it('carries the hour offset of the episode’s own variant, and the usual hour otherwise', () => {
    const earlier = EXPERIMENT_CATALOG.publish_time[1]
    expect(effectiveVariant('publish_time', { variant: { kind: 'publish_time', ...earlier } }, defaults)).toMatchObject({
      key: 'earlier',
      hourOffset: -3,
    })
    expect(effectiveVariant('publish_time', { variant: { kind: 'hook', ...EXPERIMENT_CATALOG.hook[1] } }, defaults)).toMatchObject({
      key: 'usual',
      hourOffset: 0,
      isControl: true,
    })
  })
})
