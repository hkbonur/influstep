import type { DiscountsProvider, Redemption } from './types'

/**
 * Mock redemptions: one every nine days since the window opened, ids stable
 * per code so the paid conversions dedupe between runs.
 */
export const mockDiscounts: DiscountsProvider = {
  name: 'mock',
  async redemptions(args): Promise<Redemption[]> {
    const out: Redemption[] = []
    const step = 9 * 86_400_000
    for (let at = args.since + step, index = 0; at < Date.now(); at += step, index += 1) {
      out.push({ orderId: `mock-order-${args.code.toLowerCase()}-${index}`, at })
    }
    return out
  },
}
