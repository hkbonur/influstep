import { describe, expect, it } from 'vitest'
import {
  EXPERIMENT_CATALOG,
  EXPERIMENT_KINDS,
  EXPERIMENT_SUBJECT,
  GOAL_METRICS,
  POST_KIND_VARIANT_KEYS,
  REPLY_TARGET_KEYS,
  SCRIPT_KINDS,
  METRIC_DENOMINATOR,
  METRIC_MIN_EXPOSURES,
  allocatePillars,
  bestPublishHour,
  catalogControl,
  contradictionMinExposures,
  contradicts,
  decideExperiment,
  experimentMetrics,
  leastAssigned,
  pickGoalMetric,
  pickNextExperiment,
  pillarWeights,
  shiftPillarWeights,
  variantLength,
  type ExperimentHistoryRow,
  type ExperimentKind,
} from './experiments'
import type { StrategyDefault } from './strategy'

describe('decideExperiment', () => {
  it('keeps running until every variant has enough exposures', () => {
    const decision = decideExperiment(
      [
        { key: 'a', episodes: 2, exposures: 50, successes: 10 },
        { key: 'b', episodes: 2, exposures: 400, successes: 20 },
      ],
      { minExposures: 100, minConfidence: 0.9 }
    )
    expect(decision).toBeUndefined()
  })

  it('names the leader once the difference is confident', () => {
    const decision = decideExperiment(
      [
        { key: 'control', episodes: 3, exposures: 1000, successes: 30 },
        { key: 'wrong', episodes: 3, exposures: 1000, successes: 60 },
      ],
      { minExposures: 100, minConfidence: 0.95 }
    )
    expect(decision?.winnerKey).toBe('wrong')
    expect(decision?.lift).toBeCloseTo(1, 5)
    expect(decision?.confidence).toBeGreaterThan(0.99)
  })

  it('withholds a verdict when the rates are close', () => {
    const decision = decideExperiment(
      [
        { key: 'a', episodes: 3, exposures: 1000, successes: 50 },
        { key: 'b', episodes: 3, exposures: 1000, successes: 53 },
      ],
      { minExposures: 100, minConfidence: 0.95 }
    )
    expect(decision).toBeUndefined()
  })
})

describe('the experiment catalog', () => {
  it('lists every dimension with its control first, unique keys, a length factor only on length and an hour offset only on publish time', () => {
    for (const kind of EXPERIMENT_KINDS) {
      const variants = EXPERIMENT_CATALOG[kind]
      // A description format is the link first or the code first, and a reply target the most reach or peers; every other
      // dimension has at least three arms.
      expect(variants.length, kind).toBeGreaterThanOrEqual(kind === 'description_format' || kind === 'reply_target' ? 2 : 3)
      expect(
        variants.map((variant) => variant.isControl),
        kind
      ).toEqual(variants.map((_, index) => index === 0))
      expect(new Set(variants.map((variant) => variant.key)).size, kind).toBe(variants.length)
      for (const variant of variants) {
        expect(variant.description.trim(), `${kind}/${variant.key}`).not.toBe('')
        expect(variant.description, `${kind}/${variant.key}`).not.toContain('\u2014')
        expect(variant.lengthFactor !== undefined, `${kind}/${variant.key}`).toBe(kind === 'length')
        expect(variant.hourOffset !== undefined, `${kind}/${variant.key}`).toBe(kind === 'publish_time')
      }
    }
    expect(EXPERIMENT_KINDS).toEqual([
      'hook',
      'concept',
      'sponsor',
      'length',
      'cta',
      'publish_time',
      'description_format',
      'post_kind',
      'reply_style',
      'reply_target',
    ])
    expect(SCRIPT_KINDS).toEqual(['hook', 'concept', 'sponsor', 'length', 'cta'])
    expect(EXPERIMENT_CATALOG.hook.map((variant) => variant.key)).toEqual(['howto', 'question', 'wrong', 'number', 'result'])
    expect(EXPERIMENT_CATALOG.length.map((variant) => variant.lengthFactor)).toEqual([1, 0.7, 1.3])
    expect(catalogControl('cta').key).toBe('follow')
  })

  it('keeps the post kind and reply target keys to the ones the planner and the listener know', () => {
    expect(EXPERIMENT_CATALOG.post_kind.map((variant) => variant.key)).toEqual([...POST_KIND_VARIANT_KEYS])
    expect(EXPERIMENT_CATALOG.reply_target.map((variant) => variant.key)).toEqual([...REPLY_TARGET_KEYS])
    expect(catalogControl('reply_style').key).toBe('tip')
  })

  it('decides a post or a reply experiment on views or follows only, since neither carries a link', () => {
    expect(experimentMetrics('hook')).toEqual(['views', 'watch_rate', 'follows', 'clicks', 'signups', 'paid'])
    expect(experimentMetrics('post_kind')).toEqual(['views', 'follows'])
    expect(experimentMetrics('reply_style')).toEqual(['views', 'follows'])
    expect(EXPERIMENT_KINDS.filter((kind) => EXPERIMENT_SUBJECT[kind] === 'reply')).toEqual(['reply_style', 'reply_target'])
  })

  it('moves the publish hour by three either way, with the usual hour as the control', () => {
    expect(EXPERIMENT_CATALOG.publish_time.map((variant) => [variant.key, variant.hourOffset, variant.isControl])).toEqual([
      ['usual', 0, true],
      ['earlier', -3, false],
      ['later', 3, false],
    ])
    expect(catalogControl('publish_time').label).toBe('Usual hour')
  })

  it('puts the link first by default and the code first as the challenger', () => {
    expect(EXPERIMENT_CATALOG.description_format.map((variant) => [variant.key, variant.label, variant.isControl])).toEqual([
      ['link', 'Link first', true],
      ['code', 'Code first', false],
    ])
  })

  it('needs exposures by the goal metric’s denominator', () => {
    expect(GOAL_METRICS.map((metric) => METRIC_MIN_EXPOSURES[METRIC_DENOMINATOR[metric]])).toEqual([100, 100, 2000, 2000])
  })
})

describe('pickGoalMetric', () => {
  it('aims at the metric closest to the goal that has enough successes', () => {
    expect(pickGoalMetric({ paid: 12, signups: 40, clicks: 900, follows: 300 })).toBe('paid')
    expect(pickGoalMetric({ paid: 3, signups: 10, clicks: 900, follows: 300 })).toBe('signups')
    expect(pickGoalMetric({ paid: 0, signups: 9, clicks: 10, follows: 300 })).toBe('clicks')
    expect(pickGoalMetric({ paid: 0, signups: 0, clicks: 4, follows: 50 }, 5)).toBe('follows')
  })

  it('falls to follows when nothing reaches the minimum, follows included', () => {
    expect(pickGoalMetric({ paid: 0, signups: 0, clicks: 0, follows: 0 })).toBe('follows')
  })
})

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 13)

function decided(id: string, kind: ExperimentKind, keys: [string, string], winnerKey: string, daysAgo: number): ExperimentHistoryRow {
  const variants = keys.map((key, index) => {
    const listed = EXPERIMENT_CATALOG[kind].find((variant) => variant.key === key)
    if (!listed) throw new Error(`no ${kind} variant ${key}`)
    return { ...listed, isControl: index === 0 }
  })
  return { id, kind, variants, status: 'decided', winnerKey, decidedAt: NOW - daysAgo * DAY }
}

function defaultOf(kind: ExperimentKind, key: string, experimentId: string): StrategyDefault {
  const listed = EXPERIMENT_CATALOG[kind].find((variant) => variant.key === key)
  if (!listed) throw new Error(`no ${kind} variant ${key}`)
  return { kind, key, label: listed.label, description: listed.description, experimentId, since: NOW - 30 * DAY }
}

describe('pickNextExperiment', () => {
  const kinds: ExperimentKind[] = ['hook', 'concept', 'length', 'cta']

  it('starts with the first dimension in catalog order when nothing was ever decided', () => {
    const next = pickNextExperiment({ kinds, history: [], defaults: [], contradicted: [], now: NOW })
    expect(next?.kind).toBe('hook')
    expect(next?.control).toMatchObject({ key: 'howto', isControl: true })
    expect(next?.challenger).toMatchObject({ key: 'question', isControl: false })
    expect(next?.retestOf).toBeUndefined()
  })

  it('returns null when no dimension applies', () => {
    expect(pickNextExperiment({ kinds: [], history: [], defaults: [], contradicted: [], now: NOW })).toBeNull()
  })

  it('prefers the dimension with the fewest decisions in 180 days, never decided before decided, then the one decided longest ago', () => {
    const history = [
      decided('h1', 'hook', ['howto', 'question'], 'question', 10),
      decided('c1', 'concept', ['tutorial', 'mistake'], 'tutorial', 20),
      decided('l1', 'length', ['standard', 'shorter'], 'standard', 400),
    ]
    // Length's only decision is older than 180 days, so it ties cta at none, and cta was never decided.
    expect(pickNextExperiment({ kinds, history, defaults: [], contradicted: [], now: NOW })?.kind).toBe('cta')
    const ctaDecided = [...history, decided('t1', 'cta', ['follow', 'comment'], 'comment', 30)]
    expect(pickNextExperiment({ kinds, history: ctaDecided, defaults: [], contradicted: [], now: NOW })?.kind).toBe('length')
    // Every dimension now has one recent decision; cta's, 30 days ago, is the oldest of them.
    const lengthDecided = [...ctaDecided, decided('l2', 'length', ['standard', 'longer'], 'longer', 5)]
    expect(pickNextExperiment({ kinds, history: lengthDecided, defaults: [], contradicted: [], now: NOW })?.kind).toBe('cta')
  })

  it('tests a variant other than the default against the default as the control', () => {
    const history = [decided('t1', 'cta', ['follow', 'comment'], 'comment', 30)]
    const next = pickNextExperiment({
      kinds: ['cta'],
      history,
      defaults: [defaultOf('cta', 'comment', 't1')],
      contradicted: [],
      now: NOW,
    })
    expect(next?.control).toMatchObject({ key: 'comment', isControl: true })
    // Follow lost to comment 30 days ago; link never ran.
    expect(next?.challenger).toMatchObject({ key: 'link', isControl: false })
  })

  it('takes the variant that lost longest ago once every other variant lost within 180 days', () => {
    const history = [
      decided('h1', 'hook', ['howto', 'question'], 'howto', 90),
      decided('h2', 'hook', ['howto', 'wrong'], 'howto', 60),
      decided('h3', 'hook', ['howto', 'number'], 'howto', 120),
      decided('h4', 'hook', ['howto', 'result'], 'howto', 30),
    ]
    const next = pickNextExperiment({ kinds: ['hook'], history, defaults: [], contradicted: [], now: NOW })
    expect(next?.challenger.key).toBe('number')
  })

  it('forgives a loss older than 180 days', () => {
    const history = [decided('h1', 'hook', ['howto', 'question'], 'howto', 200)]
    const next = pickNextExperiment({ kinds: ['hook'], history, defaults: [], contradicted: [], now: NOW })
    expect(next?.challenger.key).toBe('question')
  })

  it('tests a contradicted default again first, against the variant it beat', () => {
    const history = [decided('t1', 'cta', ['follow', 'comment'], 'comment', 30)]
    const next = pickNextExperiment({
      kinds,
      history,
      defaults: [defaultOf('cta', 'comment', 't1')],
      contradicted: ['cta'],
      now: NOW,
    })
    expect(next).toEqual({
      kind: 'cta',
      control: expect.objectContaining({ key: 'comment', isControl: true }),
      challenger: expect.objectContaining({ key: 'follow', isControl: false }),
      retestOf: 't1',
    })
  })

  it('tests a contradicted default of three variants again against its runner-up, not the control', () => {
    // The operator's experiment: control "How to", "Question" second, "Result first" won.
    const [howto, question, result] = ['howto', 'question', 'result'].map((key, index) => {
      const listed = EXPERIMENT_CATALOG.hook.find((variant) => variant.key === key)
      if (!listed) throw new Error(`no hook variant ${key}`)
      return { ...listed, isControl: index === 0 }
    })
    if (!howto || !question || !result) throw new Error('the hook catalog lost a variant')
    const row: ExperimentHistoryRow = {
      id: 'h1',
      kind: 'hook',
      variants: [howto, question, result],
      status: 'decided',
      winnerKey: 'result',
      decidedAt: NOW - 30 * DAY,
      runnerUpKey: 'question',
    }
    const args = { kinds, defaults: [defaultOf('hook', 'result', 'h1')], contradicted: ['hook' as const], now: NOW }
    expect(pickNextExperiment({ ...args, history: [row] })?.challenger).toMatchObject({ key: 'question', isControl: false })
    // A decision from before the runner-up's key was stored falls back to the control.
    const { runnerUpKey: _stored, ...older } = row
    expect(pickNextExperiment({ ...args, history: [older] })?.challenger).toMatchObject({ key: 'howto', isControl: false })
  })

  it('leaves a contradicted dimension alone when it no longer applies', () => {
    const history = [decided('s1', 'sponsor', ['end', 'early'], 'early', 30)]
    const next = pickNextExperiment({
      kinds: ['hook'],
      history,
      defaults: [defaultOf('sponsor', 'early', 's1')],
      contradicted: ['sponsor'],
      now: NOW,
    })
    expect(next?.kind).toBe('hook')
  })
})

describe('contradicts', () => {
  const decision = { winnerRate: 0.021, runnerUpRate: 0.014 }

  it('waits for the minimum exposures since the decision', () => {
    expect(contradicts(decision, { key: 'comment', episodes: 2, exposures: 1999, successes: 0 }, 2000)).toBe(false)
  })

  it('flags a default that fell to the runner-up’s old rate or below', () => {
    expect(contradicts(decision, { key: 'comment', episodes: 4, exposures: 5000, successes: 70 }, 2000)).toBe(true)
    expect(contradicts(decision, { key: 'comment', episodes: 4, exposures: 5000, successes: 60 }, 2000)).toBe(true)
  })

  it('trusts a default that stays above the runner-up’s old rate', () => {
    expect(contradicts(decision, { key: 'comment', episodes: 4, exposures: 5000, successes: 80 }, 2000)).toBe(false)
  })
})

describe('contradictionMinExposures', () => {
  it('asks for the metric’s minimum, whatever the experiment asked for', () => {
    expect(contradictionMinExposures('clicks', 500)).toBe(2000)
    expect(contradictionMinExposures('follows', 10)).toBe(2000)
    expect(contradictionMinExposures('watch_rate', 5000)).toBe(2000)
    expect(contradictionMinExposures('signups', 30)).toBe(100)
    expect(contradictionMinExposures('paid', 30)).toBe(100)
  })

  it('keeps the experiment’s own minimum for views per episode, which counts episodes', () => {
    expect(contradictionMinExposures('views', 12)).toBe(12)
  })
})

describe('pillarWeights', () => {
  const pillars = ['n8n tutorials', 'AI agents', 'Automation fails']

  it('gives equal shares when nothing is stored', () => {
    const weights = pillarWeights(pillars, undefined)
    expect(weights.map((entry) => entry.pillar)).toEqual(pillars)
    for (const entry of weights) expect(entry.weight).toBeCloseTo(1 / 3, 10)
    expect(pillarWeights(pillars, []).map((entry) => entry.weight)).toEqual(weights.map((entry) => entry.weight))
  })

  it('keeps stored weights, gives a new pillar the mean, drops a removed one, and normalizes', () => {
    const weights = pillarWeights(
      ['n8n tutorials', 'AI agents', 'Make'],
      [
        { pillar: 'n8n tutorials', weight: 0.5 },
        { pillar: 'AI agents', weight: 0.3 },
        { pillar: 'Automation fails', weight: 0.2 },
      ]
    )
    // Make gets the mean of 0.5 and 0.3; the three sum to 1.2 before normalizing.
    expect(weights.map((entry) => entry.pillar)).toEqual(['n8n tutorials', 'AI agents', 'Make'])
    expect(weights.map((entry) => entry.weight)).toEqual([0.5 / 1.2, 0.3 / 1.2, 0.4 / 1.2].map((weight) => expect.closeTo(weight, 10)))
  })

  it('has nothing to weigh without pillars', () => {
    expect(pillarWeights([], [{ pillar: 'gone', weight: 1 }])).toEqual([])
  })
})

describe('shiftPillarWeights', () => {
  const equal = pillarWeights(['a', 'b', 'c'], undefined)

  it('moves 0.1 from the worst pillar to the best once the best leads by 20%', () => {
    const shift = shiftPillarWeights(equal, [
      { pillar: 'a', score: 30, tiebreak: 0.01, episodes: 3 },
      { pillar: 'b', score: 20, tiebreak: 0.01, episodes: 2 },
      { pillar: 'c', score: 24, tiebreak: 0.01, episodes: 4 },
    ])
    expect(shift?.change).toEqual({ up: 'a', down: 'b' })
    expect(shift?.weights.map((entry) => entry.weight)).toEqual(
      [1 / 3 + 0.1, 1 / 3 - 0.1, 1 / 3].map((weight) => expect.closeTo(weight, 10))
    )
  })

  it('changes nothing when the best leads by less than 20%', () => {
    const scores = [
      { pillar: 'a', score: 23.9, tiebreak: 0.05, episodes: 3 },
      { pillar: 'b', score: 20, tiebreak: 0.01, episodes: 3 },
    ]
    expect(shiftPillarWeights(equal, scores)).toBeNull()
  })

  it('breaks a tie on value with clicks per view, by the same 20%', () => {
    const tie = (tiebreak: number) => [
      { pillar: 'a', score: 0, tiebreak: 0.01, episodes: 3 },
      { pillar: 'b', score: 0, tiebreak, episodes: 3 },
    ]
    expect(shiftPillarWeights(equal, tie(0.012))?.change).toEqual({ up: 'b', down: 'a' })
    expect(shiftPillarWeights(equal, tie(0.0119))).toBeNull()
  })

  it('counts only pillars with two measured episodes, and needs two of them', () => {
    expect(
      shiftPillarWeights(equal, [
        { pillar: 'a', score: 50, tiebreak: 0, episodes: 1 },
        { pillar: 'b', score: 10, tiebreak: 0, episodes: 2 },
      ])
    ).toBeNull()
    expect(shiftPillarWeights(equal, [])).toBeNull()
  })

  it('never takes a pillar under the floor', () => {
    const lopsided = [
      { pillar: 'a', weight: 0.75 },
      { pillar: 'b', weight: 0.15 },
      { pillar: 'c', weight: 0.1 },
    ]
    const scores = [
      { pillar: 'a', score: 30, tiebreak: 0, episodes: 3 },
      { pillar: 'b', score: 20, tiebreak: 0, episodes: 3 },
      { pillar: 'c', score: 10, tiebreak: 0, episodes: 3 },
    ]
    expect(shiftPillarWeights(lopsided, scores)).toBeNull()
    const partial = shiftPillarWeights(lopsided, scores.slice(0, 2))
    expect(partial?.weights.map((entry) => entry.weight)).toEqual([0.8, 0.1, 0.1].map((weight) => expect.closeTo(weight, 10)))
  })

  it('ignores a score for a pillar without a weight', () => {
    const scores = [
      { pillar: 'gone', score: 90, tiebreak: 0, episodes: 5 },
      { pillar: 'a', score: 10, tiebreak: 0, episodes: 3 },
    ]
    expect(shiftPillarWeights(equal, scores)).toBeNull()
  })
})

describe('allocatePillars', () => {
  it('shares slots by weight, ties to the pillar listed first', () => {
    const weights = pillarWeights(['a', 'b', 'c'], undefined)
    expect(allocatePillars(weights, {}, 3)).toEqual(['a', 'b', 'c'])
    expect(allocatePillars(weights, {}, 0)).toEqual([])
  })

  it('tops up the pillars the recent weeks gave less than their weight', () => {
    const weights = pillarWeights(['a', 'b', 'c'], undefined)
    expect(allocatePillars(weights, { a: 4, b: 4, c: 1 }, 3)).toEqual(['c', 'c', 'c'])
  })

  it('follows the weights over a month of slots', () => {
    const weights = [
      { pillar: 'a', weight: 0.5 },
      { pillar: 'b', weight: 0.3 },
      { pillar: 'c', weight: 0.2 },
    ]
    const picks = allocatePillars(weights, {}, 20)
    expect(picks.filter((pillar) => pillar === 'a')).toHaveLength(10)
    expect(picks.filter((pillar) => pillar === 'b')).toHaveLength(6)
    expect(picks.filter((pillar) => pillar === 'c')).toHaveLength(4)
  })

  it('ignores prior episodes of a pillar the persona no longer has', () => {
    const weights = pillarWeights(['a', 'b'], undefined)
    expect(allocatePillars(weights, { gone: 10, a: 1 }, 1)).toEqual(['b'])
  })
})

describe('bestPublishHour', () => {
  it('moves to an hour whose median is at least 20% above the current one', () => {
    const byHour = [
      { hour: 16, publications: 4, medianViews: 1000 },
      { hour: 18, publications: 3, medianViews: 1200 },
      { hour: 12, publications: 5, medianViews: 1100 },
    ]
    expect(bestPublishHour(16, byHour)).toBe(18)
  })

  it('keeps the hour when the best is less than 20% above it, or is it', () => {
    expect(
      bestPublishHour(16, [
        { hour: 16, publications: 4, medianViews: 1000 },
        { hour: 18, publications: 3, medianViews: 1199 },
      ])
    ).toBeNull()
    expect(
      bestPublishHour(16, [
        { hour: 16, publications: 4, medianViews: 2000 },
        { hour: 18, publications: 3, medianViews: 1000 },
      ])
    ).toBeNull()
  })

  it('counts only hours with three measured publications, and needs two such hours including the current one', () => {
    expect(
      bestPublishHour(16, [
        { hour: 16, publications: 4, medianViews: 1000 },
        { hour: 18, publications: 2, medianViews: 5000 },
      ])
    ).toBeNull()
    expect(
      bestPublishHour(16, [
        { hour: 16, publications: 2, medianViews: 1000 },
        { hour: 18, publications: 3, medianViews: 5000 },
        { hour: 12, publications: 3, medianViews: 900 },
      ])
    ).toBeNull()
    expect(bestPublishHour(16, [])).toBeNull()
  })
})

describe('leastAssigned', () => {
  it('picks the variant with the fewest so far, the first listed on a tie, and refuses none', () => {
    expect(leastAssigned(['tip', 'question'], {})).toBe('tip')
    expect(leastAssigned(['tip', 'question'], { tip: 3, question: 2 })).toBe('question')
    expect(leastAssigned(['reach', 'peers'], { reach: 1, peers: 1 })).toBe('reach')
    expect(() => leastAssigned([], {})).toThrow('an experiment without variants has none to assign')
  })
})

describe('variantLength', () => {
  it('scales by the length factor and rounds', () => {
    expect(variantLength(40, { lengthFactor: 0.7 })).toBe(28)
    expect(variantLength(35, { lengthFactor: 1.3 })).toBe(46)
  })

  it('keeps the length without a factor or a variant', () => {
    expect(variantLength(240, undefined)).toBe(240)
    expect(variantLength(240, {})).toBe(240)
  })

  it('never goes under ten seconds', () => {
    expect(variantLength(12, { lengthFactor: 0.7 })).toBe(10)
  })
})
