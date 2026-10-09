import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import {
  agentRoleValidator,
  checklistActionValidator,
  checklistStatusValidator,
  conversionKindValidator,
  decisionValidator,
  episodeStatusValidator,
  experimentKindValidator,
  experimentStatusValidator,
  jobKindValidator,
  jobRuntimeValidator,
  jobStatusValidator,
  metricCountsValidator,
  metricKeyValidator,
  platformValidator,
  renderValidator,
  scriptValidator,
  shotValidator,
  signalSourceValidator,
  signalStatusValidator,
  sponsorSegmentValidator,
  variantValidator,
} from './lib/validators'

export default defineSchema({
  // One workspace today (the operator's). Personas belong to it so a later
  // multi-tenant Influstep needs no migration.
  workspaces: defineTable({
    name: v.string(),
    sponsorName: v.string(),
    sponsorUrl: v.string(),
    // Public origin of the studio app, for tracked links and link-in-bio pages.
    appUrl: v.string(),
    // Hosts a screen recording may only open once the operator signed in on the
    // runner's browser profile (the checklist's open_browser action).
    signInRequiredHosts: v.array(v.string()),
    signedInHosts: v.array(v.string()),
  }),

  personas: defineTable({
    workspaceId: v.id('workspaces'),
    name: v.string(),
    handle: v.string(),
    niche: v.string(),
    tone: v.string(),
    bio: v.string(),
    // The persona "bible": how it speaks, what it never says. Read by the writer.
    bible: v.string(),
    pillars: v.array(v.string()),
    platforms: v.array(platformValidator),
    voiceId: v.string(),
    // 0..1 share of episodes that carry the sponsor (CONTEXT.md, "Sponsor dial").
    sponsorDial: v.number(),
    // The planner keeps the first N episodes unsponsored so the profile earns followers first.
    sponsorRampEpisodes: v.number(),
    episodesPerWeek: v.number(),
    autoApprove: v.boolean(),
    paused: v.boolean(),
    timezone: v.string(),
    // Local hour (0-23) publications default to.
    publishHour: v.number(),
    createdAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_handle', ['handle']),

  episodes: defineTable({
    personaId: v.id('personas'),
    slug: v.string(),
    status: episodeStatusValidator,
    concept: v.string(),
    title: v.string(),
    hook: v.string(),
    script: scriptValidator,
    sponsorSegment: sponsorSegmentValidator,
    shots: v.array(shotValidator),
    renders: v.array(renderValidator),
    // Calendar day (YYYY-MM-DD in the persona's timezone) and the publish instant.
    plannedFor: v.string(),
    scheduledAt: v.number(),
    experimentId: v.optional(v.id('experiments')),
    variantKey: v.optional(v.string()),
    signalIds: v.array(v.id('signals')),
    pillar: v.optional(v.string()),
    error: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    measuredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_persona', ['personaId'])
    .index('by_persona_day', ['personaId', 'plannedFor'])
    .index('by_status', ['status'])
    .index('by_day', ['plannedFor']),

  publications: defineTable({
    episodeId: v.id('episodes'),
    personaId: v.id('personas'),
    platform: platformValidator,
    status: v.union(v.literal('queued'), v.literal('uploading'), v.literal('live'), v.literal('failed')),
    title: v.string(),
    description: v.string(),
    linkId: v.id('links'),
    scheduledAt: v.number(),
    externalId: v.optional(v.string()),
    url: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    mock: v.boolean(),
  })
    .index('by_episode', ['episodeId'])
    .index('by_persona', ['personaId'])
    .index('by_status_scheduled', ['status', 'scheduledAt']),

  metricSnapshots: defineTable({
    personaId: v.id('personas'),
    episodeId: v.optional(v.id('episodes')),
    publicationId: v.optional(v.id('publications')),
    platform: v.optional(platformValidator),
    takenAt: v.number(),
    counts: metricCountsValidator,
    mock: v.boolean(),
  })
    .index('by_persona_time', ['personaId', 'takenAt'])
    .index('by_episode', ['episodeId'])
    .index('by_publication', ['publicationId']),

  links: defineTable({
    slug: v.string(),
    personaId: v.id('personas'),
    episodeId: v.optional(v.id('episodes')),
    platform: v.optional(platformValidator),
    target: v.string(),
    clicks: v.number(),
    createdAt: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_persona', ['personaId'])
    .index('by_episode', ['episodeId']),

  linkClicks: defineTable({
    linkId: v.id('links'),
    personaId: v.id('personas'),
    episodeId: v.optional(v.id('episodes')),
    at: v.number(),
    referrer: v.optional(v.string()),
    country: v.optional(v.string()),
  })
    .index('by_link', ['linkId'])
    .index('by_persona_time', ['personaId', 'at']),

  conversions: defineTable({
    personaId: v.id('personas'),
    episodeId: v.optional(v.id('episodes')),
    variantKey: v.optional(v.string()),
    kind: conversionKindValidator,
    distinctId: v.string(),
    at: v.number(),
    mock: v.boolean(),
  })
    .index('by_persona_time', ['personaId', 'at'])
    .index('by_distinct', ['distinctId', 'kind']),

  signals: defineTable({
    personaId: v.id('personas'),
    source: signalSourceValidator,
    externalId: v.string(),
    title: v.string(),
    url: v.string(),
    summary: v.string(),
    score: v.number(),
    topics: v.array(v.string()),
    status: signalStatusValidator,
    foundAt: v.number(),
    mock: v.boolean(),
  })
    .index('by_persona_status', ['personaId', 'status'])
    .index('by_persona_external', ['personaId', 'source', 'externalId'])
    .index('by_found', ['foundAt']),

  experiments: defineTable({
    personaId: v.id('personas'),
    name: v.string(),
    hypothesis: v.string(),
    kind: experimentKindValidator,
    metric: metricKeyValidator,
    variants: v.array(variantValidator),
    status: experimentStatusValidator,
    minExposures: v.number(),
    minConfidence: v.number(),
    decision: v.optional(decisionValidator),
    createdAt: v.number(),
  }).index('by_persona_status', ['personaId', 'status']),

  directives: defineTable({
    personaId: v.id('personas'),
    text: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
    withdrawnAt: v.optional(v.number()),
  }).index('by_persona_active', ['personaId', 'active']),

  messages: defineTable({
    personaId: v.id('personas'),
    author: v.union(v.literal('operator'), v.literal('persona')),
    text: v.string(),
    directiveId: v.optional(v.id('directives')),
    createdAt: v.number(),
  }).index('by_persona', ['personaId']),

  checklistItems: defineTable({
    personaId: v.id('personas'),
    episodeId: v.optional(v.id('episodes')),
    title: v.string(),
    why: v.string(),
    status: checklistStatusValidator,
    action: v.optional(checklistActionValidator),
    createdAt: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index('by_status', ['status'])
    .index('by_persona_status', ['personaId', 'status'])
    .index('by_episode', ['episodeId']),

  jobs: defineTable({
    kind: jobKindValidator,
    role: agentRoleValidator,
    runsOn: jobRuntimeValidator,
    status: jobStatusValidator,
    personaId: v.optional(v.id('personas')),
    episodeId: v.optional(v.id('episodes')),
    payload: v.any(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    attempts: v.number(),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index('by_runtime_status', ['runsOn', 'status'])
    .index('by_persona', ['personaId'])
    .index('by_episode', ['episodeId']),

  runners: defineTable({
    name: v.string(),
    version: v.string(),
    providersMode: v.string(),
    lastSeenAt: v.number(),
    currentJobId: v.optional(v.id('jobs')),
  }).index('by_name', ['name']),
})
