import type { AnalyticsProvider, FoundConversion } from './types'

/**
 * Mock conversions proportional to clicks, down the whole Formstep journey:
 * one demo per 10 clicks, one signup per 25, a trial for every second signup
 * and a paid for every sixth. One distinct id per mock person, derived from
 * the handle and the person's index only, so a repeat pull dedupes on
 * (distinctId, kind) instead of adding the same people again.
 */
export const mockAnalytics: AnalyticsProvider = {
  name: 'mock',
  async conversions(args): Promise<FoundConversion[]> {
    const demos = Math.floor(args.clicksSince / 10)
    const signups = Math.floor(args.clicksSince / 25)
    const out: FoundConversion[] = []
    const now = Date.now()
    const utm = { source: args.personaHandle }
    for (let i = 0; i < demos; i += 1) {
      const at = args.since + ((now - args.since) * (i + 1)) / (demos + 1)
      out.push({ kind: 'demo_started', distinctId: `mock-${args.personaHandle}-demo-${i}`, at, utm })
    }
    for (let i = 0; i < signups; i += 1) {
      const at = args.since + ((now - args.since) * (i + 1)) / (signups + 1)
      const distinctId = `mock-${args.personaHandle}-${i}`
      out.push({ kind: 'signup', distinctId, at, utm })
      if (i % 2 === 1) out.push({ kind: 'trial_started', distinctId, at: at + 3_600_000, utm })
      if (i % 6 === 5) out.push({ kind: 'paid', distinctId, at: at + 2 * 3_600_000, utm })
    }
    return out
  },
}
