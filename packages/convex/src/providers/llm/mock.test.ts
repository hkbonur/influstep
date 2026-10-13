import {
  DELIVERIES,
  EXPERIMENT_CATALOG,
  LENGTH_SEC_MAX,
  LENGTH_SEC_MIN,
  SPONSOR_SEGMENTS,
  effectiveStyle,
  hookOf,
  lengthProblem,
  scriptProblems,
  type CatalogVariant,
  type Delivery,
  type ExperimentKind,
  type SponsorSegment,
  type StrategyDefault,
} from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { mockLlm } from './mock'
import type { ScriptBrief } from './types'

const SPONSOR = 'Formstep'

/** Each delivery at the length a persona of that kind typically runs. */
const TYPICAL_LENGTH: Record<Delivery, number> = { talking_head: 35, screen_with_avatar: 300, screen_only: 60 }

/** A persona default taken from the catalog, as a decided experiment leaves one. */
function catalogDefault(kind: ExperimentKind, variant: CatalogVariant): StrategyDefault {
  return { kind, key: variant.key, label: variant.label, description: variant.description, lengthFactor: variant.lengthFactor, since: 0 }
}

function scriptBrief(args: {
  delivery: Delivery
  sponsorSegment: SponsorSegment
  lengthSec: number
  style: ScriptBrief['style']
  variant?: ScriptBrief['variant']
}): ScriptBrief {
  return {
    persona: {
      name: 'Ada Automates',
      handle: 'ada.automates',
      niche: 'automation for small teams',
      tone: 'plain',
      bible: 'Ada says the point first.',
      pillars: ['n8n tutorials'],
    },
    concept: 'React to: n8n webhooks that retry',
    pillar: 'n8n tutorials',
    sponsorSegment: args.sponsorSegment,
    sponsorName: SPONSOR,
    sponsorUrl: 'https://formstep.io',
    variant: args.variant,
    learnings: [],
    style: args.style,
    styleLines: [],
    directives: [],
    signals: [{ title: 'n8n webhooks that retry', summary: 'People ask how.', url: 'https://news.ycombinator.com/item?id=1' }],
    format: { lengthSec: args.lengthSec, delivery: args.delivery, hookNotes: ['Hook in the first two seconds.'] },
    problems: [],
  }
}

/** The style of a persona whose hook and call to action defaults are these catalog variants. */
function styleWith(hook: CatalogVariant, cta: CatalogVariant): ScriptBrief['style'] {
  return effectiveStyle({}, [catalogDefault('hook', hook), catalogDefault('cta', cta)])
}

const CONTROL_STYLE = effectiveStyle({}, undefined)

describe('the mock writer follows the style in force', () => {
  it('passes the script rules with every hook style and call to action, for every delivery and sponsor segment, from the shortest format to the longest', async () => {
    for (const hook of EXPERIMENT_CATALOG.hook) {
      for (const cta of EXPERIMENT_CATALOG.cta) {
        for (const delivery of DELIVERIES) {
          for (const sponsorSegment of SPONSOR_SEGMENTS) {
            for (const lengthSec of [LENGTH_SEC_MIN, TYPICAL_LENGTH[delivery], LENGTH_SEC_MAX]) {
              const label = `${hook.key}, ${cta.key}, ${delivery}, ${sponsorSegment}, ${lengthSec} s`
              const draft = await mockLlm.writeScript(scriptBrief({ delivery, sponsorSegment, lengthSec, style: styleWith(hook, cta) }))
              expect(scriptProblems(draft.shotPlan, { sponsorSegment, sponsorName: SPONSOR }), label).toEqual([])
              expect(lengthProblem(draft.shotPlan, lengthSec), label).toBeNull()
              // The first beat says the hook alone.
              expect(draft.shotPlan[0]?.voiceover, label).toBe(hookOf(draft.shotPlan))
            }
          }
        }
      }
    }
  })

  it('gives every hook style of the catalog a hook of its own', async () => {
    const [follow] = EXPERIMENT_CATALOG.cta
    if (!follow) throw new Error('the catalog has no call to action')
    const hooks = await Promise.all(
      EXPERIMENT_CATALOG.hook.map(async (hook) => {
        const draft = await mockLlm.writeScript(
          scriptBrief({ delivery: 'talking_head', sponsorSegment: 'none', lengthSec: 35, style: styleWith(hook, follow) })
        )
        return hookOf(draft.shotPlan)
      })
    )
    expect(new Set(hooks).size).toBe(EXPERIMENT_CATALOG.hook.length)
    expect(hooks[0]).toBe('How to n8n webhooks that retry in under a minute.')
  })

  it('opens with a confession for the episode that carries the "wrong" hook variant', async () => {
    const variant = { kind: 'hook' as const, key: 'wrong', label: 'I was wrong', description: 'Open by admitting a mistake you made.' }
    const draft = await mockLlm.writeScript(
      scriptBrief({
        delivery: 'talking_head',
        sponsorSegment: 'none',
        lengthSec: 35,
        style: effectiveStyle({ variant }, undefined),
        variant: { kind: variant.kind, key: variant.key, description: variant.description },
      })
    )
    expect(hookOf(draft.shotPlan)).toBe('I was wrong about n8n webhooks that retry.')
  })

  it('reads a call to action keyed "comment" as the closing line, never as the hook', async () => {
    const variant = { kind: 'cta' as const, key: 'comment', label: 'Comment', description: 'End with a question for the comments.' }
    const draft = await mockLlm.writeScript(
      scriptBrief({
        delivery: 'talking_head',
        sponsorSegment: 'none',
        lengthSec: 35,
        style: effectiveStyle({ variant }, undefined),
        variant: { kind: variant.kind, key: variant.key, description: variant.description },
      })
    )
    expect(hookOf(draft.shotPlan)).toBe('How to n8n webhooks that retry in under a minute.')
    expect(draft.shotPlan.at(-1)?.voiceover.endsWith('Which part of this trips you up? Tell me in the comments.')).toBe(true)
  })

  it('closes on the call to action in force, and on the follow line under the control', async () => {
    const [howto] = EXPERIMENT_CATALOG.hook
    const link = EXPERIMENT_CATALOG.cta.find((variant) => variant.key === 'link')
    if (!howto || !link) throw new Error('the catalog lacks the how-to hook or the link call to action')
    const linked = await mockLlm.writeScript(
      scriptBrief({ delivery: 'screen_only', sponsorSegment: 'demo', lengthSec: 60, style: styleWith(howto, link) })
    )
    expect(linked.shotPlan.at(-1)?.voiceover.endsWith(`Try ${SPONSOR}. The link is in the description.`)).toBe(true)

    const control = await mockLlm.writeScript(
      scriptBrief({ delivery: 'screen_only', sponsorSegment: 'none', lengthSec: 60, style: CONTROL_STYLE })
    )
    expect(control.shotPlan.at(-1)?.voiceover.endsWith('Follow Ada Automates for more n8n tutorials.')).toBe(true)
  })
})
