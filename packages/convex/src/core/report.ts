import { EXPERIMENT_CATALOG, SPONSOR_SEGMENT_LABELS, isPost, type ConversionKind, type ConversionVia } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { addDays, dayKey } from './dates'
import { workspaceOf } from './workspace'

/**
 * The reports (CONTEXT.md, "Report"): the workspace's funnel over every
 * persona, each persona's funnel and trend from metric snapshots, clicks and
 * conversions, and what works across personas. Counting rules live here so
 * the queries, the strategy review and the tests agree.
 */

export interface Funnel {
  views: number
  follows: number
  likes: number
  comments: number
  /** Views on the platforms that report a watch rate. X reports none, so its views are not among them. */
  watchedViews: number
  /** The share of a video watched, weighted by `watchedViews`; null when there are none. */
  watchRate: number | null
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
  const sum = (count: (snapshot: Doc<'metricSnapshots'>) => number) => latest.reduce((total, snapshot) => total + count(snapshot), 0)
  const watched = latest.filter((snapshot) => snapshot.platform !== undefined && snapshot.platform !== 'x')
  const watchedViews = watched.reduce((total, snapshot) => total + snapshot.counts.views, 0)
  const mock = latest.some((snapshot) => snapshot.mock) || args.conversions.some((conversion) => conversion.mock)
  return {
    views: sum((snapshot) => snapshot.counts.views),
    follows: sum((snapshot) => snapshot.counts.follows),
    likes: sum((snapshot) => snapshot.counts.likes),
    comments: sum((snapshot) => snapshot.counts.comments),
    watchedViews,
    watchRate:
      watchedViews === 0
        ? null
        : watched.reduce((total, snapshot) => total + snapshot.counts.views * snapshot.counts.watchRate, 0) / watchedViews,
    clicks: args.clicks,
    ...countConversions(args.conversions, args.valuePerPaid),
    mock,
  }
}

type Summed = Exclude<keyof Funnel, 'watchRate' | 'mock'>

/**
 * Funnels added up: every count summed, the watch rate weighted again by the
 * views it was read over. The workspace report's total over its personas.
 */
export function sumFunnels(funnels: readonly Funnel[]): Funnel {
  const sum = (key: Summed) => funnels.reduce((total, funnel) => total + funnel[key], 0)
  const watchedViews = sum('watchedViews')
  const watched = funnels.reduce((total, funnel) => total + (funnel.watchRate === null ? 0 : funnel.watchedViews * funnel.watchRate), 0)
  return {
    views: sum('views'),
    follows: sum('follows'),
    likes: sum('likes'),
    comments: sum('comments'),
    watchedViews,
    watchRate: watchedViews === 0 ? null : watched / watchedViews,
    clicks: sum('clicks'),
    demos: sum('demos'),
    signups: sum('signups'),
    trials: sum('trials'),
    paid: sum('paid'),
    paidViaCode: sum('paidViaCode'),
    value: sum('value'),
    mock: funnels.some((funnel) => funnel.mock),
  }
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

type Reader = { db: QueryCtx['db'] }

const DAY_MS = 86_400_000

/** The persona's numbers over the last `days` days, today included, in its own timezone. */
export interface ReportWindow {
  days: number
  /** Each publication's latest snapshot taken in the window, and the clicks and conversions that happened in it. */
  funnel: Funnel
  /** One point per day of the window, oldest first. */
  trend: TrendPoint[]
  currency: string
}

/**
 * The report over a window: the report page's trend (28 days), and the
 * analyst's answer when the operator asks in chat how the week went (7 days).
 * One reading, so the chat and the page never disagree about a day.
 */
export async function reportWindow(ctx: Reader, persona: Doc<'personas'>, days: number, now: number): Promise<ReportWindow> {
  const workspace = await workspaceOf(ctx, persona)
  const since = now - days * DAY_MS
  const snapshots = await ctx.db
    .query('metricSnapshots')
    .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id).gte('takenAt', since))
    .collect()
  const clicks = await ctx.db
    .query('linkClicks')
    .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id).gte('at', since))
    .collect()
  const conversions = await ctx.db
    .query('conversions')
    .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id).gte('at', since))
    .collect()
  const today = dayKey(now, persona.timezone)
  const trend = buildTrend({
    days: Array.from({ length: days }, (_, index) => addDays(today, index - days + 1)),
    snapshots,
    clicks: clicks.map((click) => ({ day: dayKey(click.at, persona.timezone) })),
    conversions: conversions.map((conversion) => ({ day: dayKey(conversion.at, persona.timezone), kind: conversion.kind })),
    snapshotDay: (snapshot) => dayKey(snapshot.takenAt, persona.timezone),
  })
  const funnel = buildFunnel({ snapshots, clicks: clicks.length, conversions, valuePerPaid: workspace.valuePerPaid })
  return { days, funnel, trend, currency: workspace.currency }
}

/**
 * Measured videos published in this many days make the report's "what works"
 * lists and score the strategy review's pillars, so both read the same facts.
 */
export const WHAT_WORKS_DAYS = 28

/** Views and link clicks of one episode, at the latest snapshot of each of its publications. */
export async function episodeReach(ctx: Reader, episodeId: Id<'episodes'>): Promise<{ views: number; clicks: number }> {
  const snapshots = latestPerPublication(
    await ctx.db
      .query('metricSnapshots')
      .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
      .collect()
  )
  const links = await ctx.db
    .query('links')
    .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
    .collect()
  return {
    views: snapshots.reduce((sum, snapshot) => sum + snapshot.counts.views, 0),
    clicks: links.reduce((sum, link) => sum + link.clicks, 0),
  }
}

/** The videos measured and published since `since`: what the "what works" lists and the pillar scores count. */
export function measuredVideosSince(episodes: readonly Doc<'episodes'>[], since: number): Doc<'episodes'>[] {
  return episodes.filter(
    (episode) => !isPost(episode.kind) && episode.status === 'measured' && episode.publishedAt !== undefined && episode.publishedAt >= since
  )
}

/** What one measured video brought: its reach, and its paid conversions, by link or by code, with their value. */
export interface VideoOutcome {
  episode: Doc<'episodes'>
  views: number
  clicks: number
  paid: number
  value: number
}

export async function videoOutcomes(
  ctx: Reader,
  videos: readonly Doc<'episodes'>[],
  conversions: readonly Pick<Doc<'conversions'>, 'kind' | 'episodeId'>[],
  valuePerPaid: number
): Promise<VideoOutcome[]> {
  const out: VideoOutcome[] = []
  for (const episode of videos) {
    const paid = conversions.filter((conversion) => conversion.kind === 'paid' && conversion.episodeId === episode._id).length
    out.push({ episode, ...(await episodeReach(ctx, episode._id)), paid, value: paid * valuePerPaid })
  }
  return out
}

/** One group of a "what works" list: the videos that share a pillar, a hook style or a sponsor segment, added up. */
export interface GroupOutcome {
  key: string
  label: string
  videos: number
  views: number
  clicks: number
  paid: number
  value: number
  valuePerVideo: number
  clicksPerView: number
  episodeIds: Id<'episodes'>[]
}

/**
 * The videos grouped by `groupOf`, ranked by value per video, then clicks per
 * view, then by label so equal groups keep one order. A video `groupOf`
 * places in no group is left out.
 */
export function rankGroups(
  outcomes: readonly VideoOutcome[],
  groupOf: (episode: Doc<'episodes'>) => { key: string; label: string } | null
): GroupOutcome[] {
  const groups = new Map<string, GroupOutcome>()
  for (const outcome of outcomes) {
    const group = groupOf(outcome.episode)
    if (!group) continue
    const entry = groups.get(group.key) ?? {
      ...group,
      videos: 0,
      views: 0,
      clicks: 0,
      paid: 0,
      value: 0,
      valuePerVideo: 0,
      clicksPerView: 0,
      episodeIds: [],
    }
    entry.videos += 1
    entry.views += outcome.views
    entry.clicks += outcome.clicks
    entry.paid += outcome.paid
    entry.value += outcome.value
    entry.episodeIds.push(outcome.episode._id)
    groups.set(group.key, entry)
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      valuePerVideo: group.value / group.videos,
      clicksPerView: group.views === 0 ? 0 : group.clicks / group.views,
    }))
    .sort((a, b) => b.valuePerVideo - a.valuePerVideo || b.clicksPerView - a.clicksPerView || a.label.localeCompare(b.label))
}

/** The hook style a video went out with, named as the catalog names it, so one style reads the same across personas. */
export function hookGroup(episode: Pick<Doc<'episodes'>, 'hookStyle'>): { key: string; label: string } | null {
  if (!episode.hookStyle) return null
  const catalog = EXPERIMENT_CATALOG.hook.find((variant) => variant.key === episode.hookStyle?.key)
  return { key: episode.hookStyle.key, label: catalog?.label ?? episode.hookStyle.label }
}

export interface WhatWorks {
  pillar: GroupOutcome[]
  hook: GroupOutcome[]
  sponsor: GroupOutcome[]
  /** Measured videos the lists count. */
  videos: number
}

/**
 * The three "what works" lists over every persona's measured videos of the
 * last WHAT_WORKS_DAYS days. A video written before scripts were stamped
 * with their hook style counts by pillar and sponsor segment only.
 */
export async function whatWorks(ctx: Reader, personas: readonly Doc<'personas'>[], valuePerPaid: number, now: number): Promise<WhatWorks> {
  const since = now - WHAT_WORKS_DAYS * DAY_MS
  const outcomes: VideoOutcome[] = []
  for (const persona of personas) {
    const episodes = await ctx.db
      .query('episodes')
      .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
      .collect()
    const conversions = await ctx.db
      .query('conversions')
      .withIndex('by_persona_time', (q) => q.eq('personaId', persona._id))
      .collect()
    outcomes.push(...(await videoOutcomes(ctx, measuredVideosSince(episodes, since), conversions, valuePerPaid)))
  }
  return {
    pillar: rankGroups(outcomes, (episode) => (episode.pillar === undefined ? null : { key: episode.pillar, label: episode.pillar })),
    hook: rankGroups(outcomes, hookGroup),
    sponsor: rankGroups(outcomes, (episode) => ({ key: episode.sponsorSegment, label: SPONSOR_SEGMENT_LABELS[episode.sponsorSegment] })),
    videos: outcomes.length,
  }
}
