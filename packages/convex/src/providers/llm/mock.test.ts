import {
  DELIVERIES,
  EXPERIMENT_CATALOG,
  LENGTH_SEC_MAX,
  LENGTH_SEC_MIN,
  SPONSOR_SEGMENTS,
  effectiveStyle,
  hookOf,
  lengthProblem,
  replyProblems,
  scriptProblems,
  type CatalogVariant,
  type Delivery,
  type ExperimentKind,
  type SponsorSegment,
  type StrategyDefault,
} from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { mockLlm } from './mock'
import type { ReplyBrief, ScriptBrief } from './types'

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
  research?: ScriptBrief['research']
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
    memory: { goal: 'Paying Formstep customers', standing: null, rules: [], facts: [], learnings: [] },
    assets: [],
    style: args.style,
    styleLines: [],
    directives: [],
    signals: [{ title: 'n8n webhooks that retry', summary: 'People ask how.', url: 'https://news.ycombinator.com/item?id=1' }],
    research: args.research ?? { brief: null, problems: [] },
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

describe('the mock writer and the research', () => {
  it('writes the same script with or without a morning brief and a problem log', async () => {
    const args = { delivery: 'screen_only' as const, sponsorSegment: 'mention' as const, lengthSec: 60, style: CONTROL_STYLE }
    const without = await mockLlm.writeScript(scriptBrief(args))
    const withResearch = await mockLlm.writeScript(
      scriptBrief({
        ...args,
        research: {
          brief: 'Hacker News found 3 items. The strongest: "n8n 2.0 is out" (Hacker News, freshness 91).',
          problems: ['Viewers keep asking: "How do I retry a failed webhook?" (3 times under my videos).'],
        },
      })
    )
    expect(withResearch).toEqual(without)
  })
})

describe('the mock reply writer', () => {
  function replyBrief(overrides: Partial<ReplyBrief> = {}): ReplyBrief {
    return {
      persona: {
        name: 'Ada Automates',
        handle: 'ada.automates',
        niche: 'automation for small teams',
        tone: 'plain',
        bible: '',
        pillars: ['n8n tutorials'],
      },
      origin: 'search',
      post: {
        text: 'Politics aside, the new AI bill could change n8n for small shops.',
        author: { handle: 'kai', name: 'Kai', followers: 25_800 },
      },
      pillar: 'n8n tutorials',
      sponsorName: SPONSOR,
      operatorAsked: false,
      memory: { goal: 'Paying Formstep customers', standing: null, rules: ['Never reply to politics.'], facts: [], learnings: [] },
      directives: [],
      voice: null,
      partLimit: 280,
      problems: [],
      ...overrides,
    }
  }

  it('passes on a post its rule covers, and answers it when the operator asks', async () => {
    expect(await mockLlm.writeReply(replyBrief())).toEqual({ kind: 'skip', reason: 'My rule "Never reply to politics." covers this post.' })
    const asked = await mockLlm.writeReply(replyBrief({ operatorAsked: true }))
    expect(asked.kind).toBe('reply')
  })

  it("answers a mention by name, within X's rules, and the sponsor only when the operator asked", async () => {
    const mention = await mockLlm.writeReply(
      replyBrief({
        origin: 'mention',
        post: { text: '@ada.automates which form tool?', author: { handle: 'tom', name: 'Tom', followers: 410 } },
      })
    )
    if (mention.kind !== 'reply') throw new Error('the mention was passed on')
    expect(mention.text).toMatch(/^Thanks for the mention, @tom!/)
    expect(replyProblems(mention.text, { sponsorName: SPONSOR, sponsorAllowed: false })).toEqual([])

    const sponsored = replyBrief({
      post: { text: 'Has anyone tried Formstep?', author: { handle: 'mira', name: 'Mira', followers: 5_400 } },
    })
    const plain = await mockLlm.writeReply(sponsored)
    if (plain.kind !== 'reply') throw new Error('the post was passed on')
    expect(plain.text).not.toContain(SPONSOR)
    const answered = await mockLlm.writeReply({ ...sponsored, operatorAsked: true })
    if (answered.kind !== 'reply') throw new Error('the asked post was passed on')
    expect(answered.text).toContain(`${SPONSOR} does that`)
  })
})
