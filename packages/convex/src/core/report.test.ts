import { describe, expect, it } from 'vitest'
import { countConversions } from './report'

describe('countConversions', () => {
  it('counts each kind, the code share of paid, and the estimated value', () => {
    const out = countConversions(
      [
        { kind: 'demo_started', via: 'utm', mock: false },
        { kind: 'signup', via: 'utm', mock: false },
        { kind: 'trial_started', via: 'utm', mock: false },
        { kind: 'paid', via: 'utm', mock: false },
        { kind: 'paid', via: 'code', mock: false },
      ],
      29
    )
    expect(out).toEqual({ demos: 1, signups: 1, trials: 1, paid: 2, paidViaCode: 1, value: 58 })
  })
})
