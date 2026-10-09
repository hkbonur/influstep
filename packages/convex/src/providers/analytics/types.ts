import type { ConversionKind } from '@influstep/shared'

export interface FoundConversion {
  kind: ConversionKind
  distinctId: string
  at: number
  utm: { source: string; medium?: string; campaign?: string; content?: string }
}

export interface AnalyticsProvider {
  readonly name: string
  /** Conversions attributed to this persona handle since `since`. */
  conversions(args: { personaHandle: string; since: number; clicksSince: number }): Promise<FoundConversion[]>
}
