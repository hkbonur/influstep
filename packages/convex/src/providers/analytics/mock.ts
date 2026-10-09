import type { AnalyticsProvider, FoundConversion } from './types'

/**
 * Mock conversions proportional to clicks: about one signup per 25 clicks and
 * one paid per 6 signups, spread over the window. Seeded by the handle so a
 * demo stays stable between runs.
 */
export const mockAnalytics: AnalyticsProvider = {
  name: 'mock',
  async conversions(args): Promise<FoundConversion[]> {
    const signups = Math.floor(args.clicksSince / 25)
    const out: FoundConversion[] = []
    const now = Date.now()
    for (let i = 0; i < signups; i += 1) {
      const at = args.since + ((now - args.since) * (i + 1)) / (signups + 1)
      const distinctId = `mock-${args.personaHandle}-${Math.floor(args.since / 86_400_000)}-${i}`
      out.push({ kind: 'signup', distinctId, at, utm: { source: args.personaHandle } })
      if (i % 6 === 5) out.push({ kind: 'paid', distinctId, at: at + 3_600_000, utm: { source: args.personaHandle } })
    }
    return out
  },
}
