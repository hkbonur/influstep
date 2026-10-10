import type { ConversionKind, ConversionVia } from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'

/**
 * The persona report (CONTEXT.md, "Report"): one funnel and one trend from
 * metric snapshots, clicks and conversions. Counting rules live here so the
 * query and the tests agree.
 */

export interface Funnel {
  views: number
  follows: number
  clicks: number
  demos: number
  signups: number
  trials: number
  paid: number
  /** Paid conversions that came through a discount code rather than a tracked link. */
  paidViaCode: number
  /** Paid times the workspace's value per paid conversion. */
  value: number
  /** True when any input was mock data, so the report can say so. */
  mock: boolean
}

export interface TrendPoint {
  day: string
  views: number
  clicks: number
  signups: number
}

/** The latest snapshot per publication is the truth for platform counts; earlier ones are history. */
export function latestPerPublication(snapshots: Doc<'metricSnapshots'>[]): Doc<'metricSnapshots'>[] {
  const latest = new Map<string, Doc<'metricSnapshots'>>()
  for (const snapshot of snapshots) {
    const key = snapshot.publicationId ?? `persona:${snapshot.personaId}`
    const current = latest.get(key)
    if (!current || current.takenAt < snapshot.takenAt) latest.set(key, snapshot)
  }
  return [...latest.values()]
}

export type ConversionLike = { kind: ConversionKind; via: ConversionVia; mock: boolean }

export function countConversions(conversions: ConversionLike[], valuePerPaid: number) {
  const count = (kind: ConversionKind) => conversions.filter((conversion) => conversion.kind === kind).length
  const paid = count('paid')
  return {
    demos: count('demo_started'),
    signups: count('signup'),
    trials: count('trial_started'),
    paid,
    paidViaCode: conversions.filter((conversion) => conversion.kind === 'paid' && conversion.via === 'code').length,
    value: paid * valuePerPaid,
  }
}

export function buildFunnel(args: {
  snapshots: Doc<'metricSnapshots'>[]
  clicks: number
  conversions: ConversionLike[]
  valuePerPaid: number
}): Funnel {
  const latest = latestPerPublication(args.snapshots)
  const views = latest.reduce((sum, snapshot) => sum + snapshot.counts.views, 0)
  const follows = latest.reduce((sum, snapshot) => sum + snapshot.counts.follows, 0)
  const mock = latest.some((snapshot) => snapshot.mock) || args.conversions.some((conversion) => conversion.mock)
  return { views, follows, clicks: args.clicks, ...countConversions(args.conversions, args.valuePerPaid), mock }
}

export function buildTrend(args: {
  days: string[]
  snapshots: Doc<'metricSnapshots'>[]
  clicks: { day: string }[]
  conversions: { day: string; kind: Doc<'conversions'>['kind'] }[]
  snapshotDay: (snapshot: Doc<'metricSnapshots'>) => string
}): TrendPoint[] {
  // Views per day: the growth of each publication's latest count between days.
  const viewsByDay = new Map<string, number>()
  const byPublication = new Map<string, Doc<'metricSnapshots'>[]>()
  for (const snapshot of args.snapshots) {
    const key = snapshot.publicationId ?? 'persona'
    byPublication.set(key, [...(byPublication.get(key) ?? []), snapshot])
  }
  for (const series of byPublication.values()) {
    const ordered = [...series].sort((a, b) => a.takenAt - b.takenAt)
    let previous = 0
    for (const snapshot of ordered) {
      const day = args.snapshotDay(snapshot)
      viewsByDay.set(day, (viewsByDay.get(day) ?? 0) + Math.max(0, snapshot.counts.views - previous))
      previous = snapshot.counts.views
    }
  }
  return args.days.map((day) => ({
    day,
    views: viewsByDay.get(day) ?? 0,
    clicks: args.clicks.filter((click) => click.day === day).length,
    signups: args.conversions.filter((conversion) => conversion.day === day && conversion.kind === 'signup').length,
  }))
}
