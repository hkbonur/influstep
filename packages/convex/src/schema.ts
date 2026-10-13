import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import {
  accountPostSourceValidator,
  accountSourceCountsValidator,
  agentRoleValidator,
  aspectRatioValidator,
  checklistActionValidator,
  checklistStatusValidator,
  conversionKindValidator,
  conversionViaValidator,
  decisionValidator,
  episodeFormatValidator,
  episodeKindValidator,
  episodePostValidator,
  episodeStatusValidator,
  experimentKindValidator,
  experimentStatusValidator,
  jobKindValidator,
  jobRuntimeValidator,
  jobStatusValidator,
  metricCountsValidator,
  metricKeyValidator,
  personaColorValidator,
  platformFormatValidator,
  platformValidator,
  postIntentValidator,
  postLengthValidator,
  renderValidator,
  scriptValidator,
  shotPlanValidator,
  shotValidator,
  signalSourceValidator,
  signalStatusValidator,
  sponsorSegmentValidator,
  variantValidator,
  voiceCountsValidator,
  voiceValidator,
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
    // What one paid conversion is worth to the sponsor, for the report's estimate.
    valuePerPaid: v.number(),
    currency: v.string(),
  }),

  personas: defineTable({
    workspaceId: v.id('workspaces'),
    name: v.string(),
    // The avatar's identity color, so the operator tells personas apart; never a status.
    color: personaColorValidator,
    handle: v.string(),
    niche: v.string(),
    tone: v.string(),
    bio: v.string(),
    // The persona "bible": how it speaks, what it never says. Read by the writer.
    bible: v.string(),
    pillars: v.array(v.string()),
    // One format per platform the persona publishes on; the list is the persona's platforms (core/formats.ts).
    formats: v.array(platformFormatValidator),
    voiceId: v.string(),
    // 0..1 share of episodes that carry the sponsor (CONTEXT.md, "Sponsor dial").
    sponsorDial: v.number(),
    // The planner keeps the first N episodes unsponsored so the profile earns followers first.
    sponsorRampEpisodes: v.number(),
    episodesPerWeek: v.number(),
    autoApprove: v.boolean(),
    paused: v.boolean(),
    timezone: v.string(),
    // How the X account this persona took over writes, learned from its imported posts (accountPosts) and
    // edited by the operator. Absent until the analyst learns it, and again once the history is cleared.
    voice: v.optional(voiceValidator),
    createdAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_handle', ['handle']),

  episodes: defineTable({
    personaId: v.id('personas'),
    slug: v.string(),
    // A video, or a post that goes only to X (shared EPISODE_KINDS). A post never has a format, a shot plan
    // or shots, its script stays empty, and its renders hold at most the one card of an image post.
    kind: episodeKindValidator,
    status: episodeStatusValidator,
    concept: v.string(),
    title: v.string(),
    // A video's first sentence; a post's first line (shared postHook). Either way the experiments' hook unit.
    hook: v.string(),
    script: scriptValidator,
    // A post's parts and card title, exactly what X receives. Set once the post is written; never on a video.
    post: v.optional(episodePostValidator),
    // What a post sets out to do and how long it runs (shared post-mix.ts), set by the planner for every post
    // slot; never on a video. A thread is always long, a text or image post never is (core/posts.ts).
    intent: v.optional(postIntentValidator),
    length: v.optional(postLengthValidator),
    sponsorSegment: sponsorSegmentValidator,
    // The platforms this episode goes to: a non-empty subset of the persona's.
    platforms: v.array(platformValidator),
    // Set when the episode is scripted, from the persona's formats for its platforms at that moment,
    // so a later settings change does not alter a written script.
    format: v.optional(episodeFormatValidator),
    // The writer's beats, kept so the shots can be derived again when the platforms change.
    shotPlan: v.optional(shotPlanValidator),
    shots: v.array(shotValidator),
    renders: v.array(renderValidator),
    // Calendar day (YYYY-MM-DD in the persona's timezone) and the first publish instant among its platforms.
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

  // One episode on one platform. A video publication has `aspect` (the render it uploads, the cut the episode
  // was scripted to for its platform) and `description`. A post publication goes to X and has `parts`, the post
  // exactly as written (no footer), and `aspect` only for an image post (its card's).
  publications: defineTable({
    episodeId: v.id('episodes'),
    personaId: v.id('personas'),
    platform: platformValidator,
    aspect: v.optional(aspectRatioValidator),
    status: v.union(v.literal('queued'), v.literal('uploading'), v.literal('live'), v.literal('failed')),
    title: v.string(),
    description: v.optional(v.string()),
    parts: v.optional(v.array(v.string())),
    // The code the description was written with, so a page shows what viewers see, not the code in force now.
    // Absent on X: a post and a video's X text carry no code.
    discountCodeId: v.optional(v.id('discountCodes')),
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

  // The history of the X account a persona took over (docs/plan.md, slice 5): imported from the X archive,
  // pasted by the operator, or read from the timeline. Read only: importing never posts, likes or follows.
  // A self-thread is one row with its parts, root first. Example posts are the ones the writer imitates.
  accountPosts: defineTable({
    personaId: v.id('personas'),
    // The X id of the post (a thread's root), or `paste-<hash>` for a pasted post; unique per persona.
    externalId: v.string(),
    parts: v.array(v.string()),
    postedAt: v.number(),
    likes: v.number(),
    reposts: v.number(),
    replies: v.number(),
    // Likes plus reposts (core/account.ts, engagementOf), stored so the top posts are read through an index.
    // Set once on import: a stored post is never overwritten, so its counts never change.
    engagement: v.number(),
    // A reply to someone else's post; the voice is learned from the rest (the originals).
    isReply: v.boolean(),
    // The language X detected; absent when it could not tell.
    lang: v.optional(v.string()),
    source: accountPostSourceValidator,
    example: v.boolean(),
    importedAt: v.number(),
  })
    .index('by_persona_posted', ['personaId', 'postedAt'])
    .index('by_persona_external', ['personaId', 'externalId'])
    .index('by_persona_example', ['personaId', 'example'])
    // The originals (isReply false) most engaging first, and newest first: the top posts and what the analyst reads.
    .index('by_persona_reply_engagement', ['personaId', 'isReply', 'engagement', 'postedAt'])
    .index('by_persona_reply_posted', ['personaId', 'isReply', 'postedAt']),

  // What a persona's imported history counts, kept as posts are imported and deleted (core/account.ts), so
  // the totals and the voice are read from one row and never from every post. One row per persona that
  // holds imported posts: none before the first import, and none once Clear history is done.
  accountCounts: defineTable({
    personaId: v.id('personas'),
    // Every imported post by where it came from; together, all of them.
    bySource: accountSourceCountsValidator,
    // The account's own posts counted for the voice (shared VoiceCounts); together, the originals.
    originals: voiceCountsValidator,
    // Clear history is deleting the posts a page at a time; importing and learning the voice wait until it is done.
    clearing: v.boolean(),
  }).index('by_persona', ['personaId']),

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
    via: conversionViaValidator,
    distinctId: v.string(),
    at: v.number(),
    mock: v.boolean(),
  })
    .index('by_persona_time', ['personaId', 'at'])
    .index('by_distinct', ['distinctId', 'kind']),

  // Discount codes the operator created in Polar and handed to a persona, in
  // chat or in its settings. A code bound to an episode goes into that
  // episode's descriptions; a persona code goes into every other one.
  discountCodes: defineTable({
    personaId: v.id('personas'),
    episodeId: v.optional(v.id('episodes')),
    code: v.string(),
    // What the code offers, in the operator's words ("20% off for 3 months").
    offer: v.string(),
    active: v.boolean(),
    redemptions: v.number(),
    createdAt: v.number(),
    retiredAt: v.optional(v.number()),
  })
    .index('by_persona_active', ['personaId', 'active'])
    .index('by_episode', ['episodeId'])
    .index('by_code', ['code']),

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
    // The last heartbeat of the runner process running this job; a running job that goes quiet is orphaned.
    aliveAt: v.optional(v.number()),
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
