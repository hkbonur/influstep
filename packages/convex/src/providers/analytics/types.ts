import type { ConversionKind } from '@influstep/shared'

export interface FoundConversion {
  kind: ConversionKind
  distinctId: string
  at: number
  utm: { source: string; medium?: string; campaign?: string; content?: string }
  /** The discount code the purchase used, when the event carries one; such a purchase is counted from the billing side instead. */
  discountCode?: string
}

export interface AnalyticsProvider {
  readonly name: string
  /** Conversions attributed to this persona handle since `since`. */
  conversions(args: { personaHandle: string; since: number; clicksSince: number }): Promise<FoundConversion[]>
}
