import { z } from 'zod'
import { requireEnv } from '../../lib/env'
import type { AnalyticsProvider, FoundConversion } from './types'

/** Formstep's PostHog events that count as conversions (ADR 0003, docs/plan.md "What Formstep must emit"). */
const EVENT_TO_KIND = {
  demo_started: 'demo_started',
  signed_up: 'signup',
  trial_started: 'trial_started',
  subscription_started: 'paid',
} as const
const EVENT_LIST = Object.keys(EVENT_TO_KIND)
  .map((event) => `'${event}'`)
  .join(', ')

const resultSchema = z.object({ results: z.array(z.array(z.unknown())) })

/**
 * PostHog query API with HogQL over the person's initial UTM properties, so
 * a signup credits the first persona link the person ever clicked.
 */
export const posthogAnalytics: AnalyticsProvider = {
  name: 'posthog',
  async conversions(args): Promise<FoundConversion[]> {
    const host = requireEnv('POSTHOG_HOST')
    const projectId = requireEnv('POSTHOG_PROJECT_ID')
    const apiKey = requireEnv('POSTHOG_API_KEY')
    const since = new Date(args.since).toISOString()
    const query = `
      select event, distinct_id, timestamp,
             person.properties.$initial_utm_medium, person.properties.$initial_utm_campaign, person.properties.$initial_utm_content,
             properties.discount_code
      from events
      where event in (${EVENT_LIST})
        and person.properties.$initial_utm_source = {handle}
        and timestamp > {since}
      order by timestamp asc
      limit 1000`
    const response = await fetch(`${host}/api/projects/${projectId}/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query, values: { handle: args.personaHandle, since } } }),
    })
    if (!response.ok) throw new Error(`PostHog query failed: ${response.status} ${await response.text()}`)
    const parsed = resultSchema.parse(await response.json())
    const out: FoundConversion[] = []
    for (const row of parsed.results) {
      const [event, distinctId, timestamp, medium, campaign, content, discountCode] = row
      if (typeof event !== 'string' || !(event in EVENT_TO_KIND)) continue
      out.push({
        kind: EVENT_TO_KIND[event as keyof typeof EVENT_TO_KIND],
        distinctId: String(distinctId),
        at: new Date(String(timestamp)).getTime(),
        utm: { source: args.personaHandle, medium: asString(medium), campaign: asString(campaign), content: asString(content) },
        discountCode: asString(discountCode),
      })
    }
    return out
  },
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
