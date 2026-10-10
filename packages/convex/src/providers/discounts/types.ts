/**
 * Where discount-code redemptions are read from. The operator creates the
 * codes by hand in the billing provider; Influstep only counts what they did.
 */
export interface Redemption {
  /** The order id on the billing side; it dedupes the paid conversion. */
  orderId: string
  at: number
}

export interface DiscountsProvider {
  readonly name: string
  redemptions(args: { code: string; since: number }): Promise<Redemption[]>
}
