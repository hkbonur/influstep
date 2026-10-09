import { describe, expect, it } from 'vitest'
import { decideExperiment } from './experiments'

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
