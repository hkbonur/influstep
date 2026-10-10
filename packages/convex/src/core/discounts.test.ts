import { describe, expect, it } from 'vitest'
import { redemptionOwner } from './discounts'

const first = { id: 'first', createdAt: 100 }
const second = { id: 'second', createdAt: 200 }

describe('redemptionOwner', () => {
  it('gives an order to the latest row handed out before it', () => {
    expect(redemptionOwner([second, first], 150)?.id).toBe('first')
    expect(redemptionOwner([second, first], 250)?.id).toBe('second')
  })
  it('keeps an order after the last retirement on the last row, since old videos still carry the code', () => {
    expect(redemptionOwner([{ ...first, retiredAt: 120 }], 500)?.id).toBe('first')
  })
  it('owns nothing before the first row existed', () => {
    expect(redemptionOwner([first, second], 50)).toBeUndefined()
  })
})
