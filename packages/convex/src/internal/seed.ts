import { v } from 'convex/values'
import {
  AUTO_MIN_CONFIDENCE,
  DEFAULT_FORMATS,
  EXPERIMENT_CATALOG,
  METRIC_MIN_EXPOSURES,
  WEEKDAY_LABELS,
  X_IMAGE_ASPECT,
  formatAspects,
  hookOf,
  postHook,
  postLengthOf,
  postSlotHours,
  decideExperiment,
  resolveEpisodeFormat,
  variantRate,
  voiceStats,
  weekdayOf,
  type AssetKind,
  type CatalogVariant,
  type EpisodePost,
  type ExperimentKind,
  type ImportedPost,
  type Platform,
  type PlatformFormat,
  type PostIntent,
  type PostKind,
  type ProducePayload,
  type SponsorSegment,
  type VoiceEdit,
} from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Id, TableNames } from '../_generated/dataModel'
import { internalAction, internalMutation } from '../_generated/server'
import { insertAccountPosts, topOriginalsOf } from '../core/account'
import { openXChecklist } from '../core/checklist'
import { addDays, dayKey, instantAt, weekStart } from '../core/dates'
import { createIdea, createPostPublication, createTrackedLink, shotsFromDraft } from '../core/episodes'
import { analystDecisionNote, applyExperimentDecision, startExperiment, variantStatsFor } from '../core/experiments'
import { earliestPublishAt, formatFor, formatsFor, platformsOf, publishHourFor } from '../core/formats'
import { rememberFromOperator } from '../core/memory'
import { signalConcept } from '../core/planner'
import { logRepeatedQuestions, writeDailyBrief } from '../core/research'
import { reviewStrategy } from '../core/strategy'
import { enqueueJob } from '../jobs/queue'
import type { FoundConversion } from '../providers/analytics'
import { mockAnalytics } from '../providers/analytics/mock'
import { mockDiscounts } from '../providers/discounts/mock'
import { PRESENTER_TOOL } from '../providers/llm'
import type { StoredBeat } from '../lib/validators'

/**
 * The demo workspace: two personas, a planned week, a running experiment,
 * signals, one episode at every status, a post of every kind on X, the X
 * account Ada took over with its history and learned voice, and a month of
 * history so the report shows a funnel on first open. Ada also has a
 * strategy: a call to action her analyst tested and decided in September, the
 * learning and default it left, and a review a week ago with the learning and
 * the goal note it wrote. Her memory also holds a fact the operator told her in
 * the chat and a rule added on the memory page. Max has none, so his first
 * review starts an experiment. `pnpm seed` runs this; it is idempotent
 * by workspace name.
 */

const TIMEZONE = 'Europe/Oslo'
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** A variant of the experiment catalog by key, so the seeded experiments use the catalog's own words. */
function catalogVariant(kind: ExperimentKind, key: string): CatalogVariant {
  const variant = EXPERIMENT_CATALOG[kind].find((candidate) => candidate.key === key)
  if (!variant) throw new Error(`the ${kind} catalog has no variant "${key}"`)
  return variant
}

/** The closing line of a seeded video by its call to action, worded like the mock writer's. */
const SEEDED_CLOSINGS = {
  follow: 'Follow Ada for the next one.',
  comment: 'Which part of this trips you up? Tell me in the comments.',
} as const

/** Ada posts everywhere, on the defaults, with a shorter YouTube tutorial and a slightly longer TikTok. On X she also writes posts. */
const ADA_FORMATS: PlatformFormat[] = [
  { platform: 'youtube', ...DEFAULT_FORMATS.youtube, lengthSec: 240 },
  { platform: 'tiktok', ...DEFAULT_FORMATS.tiktok, lengthSec: 40 },
  { platform: 'instagram', ...DEFAULT_FORMATS.instagram },
  { platform: 'x', ...DEFAULT_FORMATS.x },
]

/** Max is a TikTok-only talking-head creator: no screen, no sign-in, one cut, his own hook and hour. */
const MAX_FORMATS: PlatformFormat[] = [
  {
    platform: 'tiktok',
    ...DEFAULT_FORMATS.tiktok,
    hookNote: 'Open mid-sentence, as if the agent just failed. Show the fix. One takeaway.',
    publishHour: 17,
  },
]

/** Where Ada's screen beats record: the n8n she runs in docker. */
const N8N_URL = 'http://localhost:5678'

/**
 * The beats of a seeded video, as the writer leaves them: the hook opens the
 * first beat, the fix is shown in n8n, the sponsor comes in as the segment
 * asks (a sponsored sentence for a mention, a beat on its own screen for a
 * demo, nothing otherwise), and the call to action closes the last beat.
 */
function seededBeats(args: {
  hook: string
  opener: Omit<StoredBeat, 'voiceover'>
  fix: string
  sponsorSegment: SponsorSegment
  sponsorName: string
  sponsorUrl: string
  /** The call to action that closes the last beat. */
  closing: string
  /** An asset of the library the fix beat shows in place of n8n. */
  fixAssetId?: Id<'assets'>
}): StoredBeat[] {
  const mention = `This one is sponsored by ${args.sponsorName}: when the workflow needs something from a customer, ${args.sponsorName} collects it.`
  const beats: StoredBeat[] = [
    { ...args.opener, voiceover: `${args.hook} Here is the setup.` },
    {
      title: 'The fix',
      voiceover: args.sponsorSegment === 'mention' ? `${args.fix} ${mention}` : args.fix,
      tool: 'n8n',
      url: N8N_URL,
      ...(args.fixAssetId === undefined ? {} : { assetId: args.fixAssetId }),
    },
  ]
  if (args.sponsorSegment === 'demo') {
    beats.push({
      title: `${args.sponsorName} demo`,
      voiceover: `Here is ${args.sponsorName}, who sponsored this video, collecting the answer from the customer and handing it back to n8n.`,
      tool: args.sponsorName,
      url: args.sponsorUrl,
    })
  }
  return beats.map((beat, index) => (index === beats.length - 1 ? { ...beat, voiceover: `${beat.voiceover} ${args.closing}` } : beat))
}

/** The writer's description of a seeded video: what it shows, in Ada's voice, with no link, code or disclosure. */
function seededDescription(concept: string): string {
  return `${concept}, shown in n8n from the failing node to the fix. No plugins you do not need.`
}

/** The card title of the seeded image post; the seeded card image shows the same words. */
const SEEDED_CARD_TITLE = 'Set an error workflow first'

/** One post of the X account Ada took over, newest first. */
interface SeededAccountPost {
  parts: string[]
  likes: number
  reposts: number
  replies: number
}

/**
 * The originals of Ada's X account before Influstep ran it, newest first:
 * mostly full posts, a third one-liners, a few threads, an emoji now and
 * then and a hashtag twice. Written by hand for the demo, not generated by
 * the mock timeline (mockXHistory), and stored with source `mock` because
 * nothing read them from X. Their ids (`seed-ada-x-N`) differ from the mock
 * timeline's, so Import from X in mock mode adds its 40 generated posts next
 * to these.
 */
const ADA_X_ORIGINALS: SeededAccountPost[] = [
  { parts: ['Every workflow needs an error workflow. Every single one.'], likes: 287, reposts: 35, replies: 14 },
  {
    parts: [
      "n8n's Wait node can pause a workflow for days without holding anything open. I use it for approvals: send the request, wait for the webhook, carry on. No polling, no cron, nothing to babysit.",
    ],
    likes: 164,
    reposts: 21,
    replies: 9,
  },
  { parts: ['If a node moves money, turn retries off.'], likes: 141, reposts: 18, replies: 6 },
  {
    parts: [
      'An AI agent in n8n went into a loop last week and made 1,900 calls in an hour. What I changed:',
      'Max iterations on every agent node. 10 is plenty.',
      'A cost check before the loop: if the run has spent more than a set amount, stop and alert.',
      'Read-only tools by default. Write access is a separate, approved step.',
    ],
    likes: 400,
    reposts: 61,
    replies: 37,
  },
  {
    parts: [
      'Most automation fails are not code fails. They are a field someone renamed in the CRM on a Tuesday. Validate the shape of what comes in before you act on it, and fail loudly when it changes.',
    ],
    likes: 312,
    reposts: 40,
    replies: 19,
  },
  { parts: ['Webhook first, schedule second. Polling is a tax you pay forever.'], likes: 96, reposts: 11, replies: 4 },
  {
    parts: [
      'I moved a client from 14 Zapier zaps to 3 n8n workflows. The bill went down, but the real win was one place to look when something breaks.',
    ],
    likes: 120,
    reposts: 9,
    replies: 7,
  },
  {
    parts: [
      'Split In Batches is the node I see misused most. If your API allows 10 requests a second, batch by 10 and add a 1 second wait. Rate limits are not suggestions.',
    ],
    likes: 88,
    reposts: 12,
    replies: 3,
  },
  { parts: ['The best n8n node is the one you deleted.'], likes: 73, reposts: 6, replies: 2 },
  {
    parts: [
      'Three webhook mistakes I see every week:',
      'Responding after the work instead of before. The sender times out and retries, and now you did the work twice.',
      'No idempotency key. Same retry, same double work.',
      'No signature check. Anyone with the URL can trigger it.',
    ],
    likes: 254,
    reposts: 48,
    replies: 16,
  },
  {
    parts: [
      'Tried an AI agent node that writes its own SQL. It worked on the first try, which worried me more than if it had failed. Read-only credentials, always.',
    ],
    likes: 109,
    reposts: 8,
    replies: 11,
  },
  { parts: ['Pin your test data. Future you will not remember what the payload looked like.'], likes: 64, reposts: 5, replies: 1 },
  {
    parts: [
      'The error trigger gives you the execution id. Put it in the alert message. When something breaks at 3am you want one click to the run, not a search.',
    ],
    likes: 77,
    reposts: 7,
    replies: 2,
  },
  { parts: ['Name your nodes. "HTTP Request 7" is not a name.'], likes: 58, reposts: 4, replies: 3 },
  {
    parts: [
      'Self-hosting n8n? Back up the database, not just the workflows. Credentials and execution history live there, and you only learn that once.',
    ],
    likes: 92,
    reposts: 14,
    replies: 5,
  },
  {
    parts: [
      'A good automation is boring. It runs, it logs, it tells you when it could not. If yours needs you to check on it, it is not done yet. #automation',
    ],
    likes: 47,
    reposts: 3,
    replies: 1,
  },
  {
    parts: [
      "How I structure every client's n8n instance, in four folders:",
      '1. Inbound: webhooks and triggers. Nothing else lives here.',
      '2. Core: the workflows that do the work, called from inbound.',
      '3. Errors: one error workflow per client, plus the canary.\n4. Sandbox: anything I am testing. Deleted every Friday.',
    ],
    likes: 186,
    reposts: 27,
    replies: 8,
  },
  { parts: ['An AI agent without a timeout is a bill waiting to happen.'], likes: 133, reposts: 15, replies: 6 },
  {
    parts: [
      'Unpopular opinion: you do not need an AI agent for most of what people build agents for. A Switch node and three clear rules cover it, and they never hallucinate.',
    ],
    likes: 231,
    reposts: 22,
    replies: 41,
  },
  {
    parts: [
      'What is the one n8n workflow you would rebuild first if you lost them all? Mine is the invoice reminder. It pays for everything else.',
    ],
    likes: 39,
    reposts: 2,
    replies: 23,
  },
  { parts: ['Shipped a fix at 9. Broke it at 9:04. Fixed it properly at 9:30. ✅'], likes: 52, reposts: 1, replies: 4 },
  {
    parts: [
      'New in n8n this month: execution data you can search by field. If you debug webhooks for a living, this alone is worth the upgrade 🎉',
    ],
    likes: 68,
    reposts: 10,
    replies: 2,
  },
  {
    parts: [
      'Every approval flow I build has the same three outcomes: approve, reject, and no answer. The third one is the one people forget, and the one that stalls the whole process.',
    ],
    likes: 101,
    reposts: 13,
    replies: 5,
  },
  { parts: ['Read the execution log before you read the docs.'], likes: 44, reposts: 3, replies: 0 },
  {
    parts: [
      'Before you automate a process, do it by hand five times.',
      'The first time you learn the steps. By the third you see the exceptions. By the fifth you know which exception happens every week.',
      'Automate the steps and the weekly exception. Send the rest to a human.',
    ],
    likes: 148,
    reposts: 19,
    replies: 6,
  },
  {
    parts: [
      'The Code node is not a failure. It is the escape hatch that keeps the other 40 nodes simple. Use it when the alternative is six nodes doing string surgery.',
    ],
    likes: 83,
    reposts: 6,
    replies: 4,
  },
  { parts: ['Small workflows, chained, beat one big one every time.'], likes: 61, reposts: 5, replies: 2 },
  {
    parts: [
      'Test with real data, not the sample. Real data has emoji in names, empty arrays, and the customer who typed their phone number in the email field.',
    ],
    likes: 97,
    reposts: 9,
    replies: 3,
  },
  {
    parts: [
      'Credentials expire. Put a reminder in the workflow itself: a weekly check that calls each API once and tells you which one went stale.',
    ],
    likes: 35,
    reposts: 2,
    replies: 1,
  },
  {
    parts: ['Question for n8n folks: do you keep credentials per environment or one set for all?'],
    likes: 12,
    reposts: 0,
    replies: 18,
  },
  {
    parts: [
      'What a good error alert says, in order:',
      'Which workflow, which node, which run (with a link).',
      'What it was trying to do, in one plain sentence.',
      'Whether it will retry, and what you should do if it does not.',
    ],
    likes: 126,
    reposts: 17,
    replies: 4,
  },
  {
    parts: [
      'I keep a workflow called "canary" that does nothing but run every 5 minutes and post to a channel. When it goes quiet, the server is the problem, not my automations. #n8n',
    ],
    likes: 71,
    reposts: 8,
    replies: 6,
  },
  { parts: ['Monday rule: nothing new goes live before coffee ☕'], likes: 26, reposts: 0, replies: 2 },
  {
    parts: [
      'Make or n8n? If your team writes code, n8n. If nobody does and nobody will, Make. Both are fine. Picking one and learning it well beats switching every quarter.',
    ],
    likes: 158,
    reposts: 12,
    replies: 29,
  },
  {
    parts: [
      'Moved 30 workflows from Zapier to n8n for a small agency. The parts nobody warns you about:',
      "Zapier's formatter steps become Code or Set nodes. Budget a day for those alone.",
      "Your team's muscle memory. Write a one-page map of old zap to new workflow.",
      'Run both for a week. Compare outputs before you turn the old one off. 🙏',
    ],
    likes: 205,
    reposts: 31,
    replies: 12,
  },
  {
    parts: ['Retries hide problems. Log every retry, and if the same node retries every day, it is not flaky, it is broken.'],
    likes: 0,
    reposts: 0,
    replies: 0,
  },
]

/** Ada's replies to other people on the same account; the voice is not learned from these. */
const ADA_X_REPLIES: SeededAccountPost[] = [
  {
    parts: ['@maria_ops Yes, the Wait node survives a restart. The state is in the database, not in memory.'],
    likes: 12,
    reposts: 0,
    replies: 1,
  },
  {
    parts: ['@devjonas Pin the data on the trigger node, then run from the next node. Saves a lot of clicking.'],
    likes: 8,
    reposts: 1,
    replies: 0,
  },
  {
    parts: ['@claire_builds Thanks! The canary workflow is literally one Schedule node and one Slack node.'],
    likes: 5,
    reposts: 0,
    replies: 1,
  },
  {
    parts: ['@tomasz Not yet. I would put a queue in front of it before I trusted it with that volume.'],
    likes: 3,
    reposts: 0,
    replies: 0,
  },
]

/** What the analyst wrote about Ada's account when it learned the voice; the counted part comes from voiceStats. */
const ADA_VOICE_TEXT: VoiceEdit = {
  language: 'en',
  summary:
    'Calm, precise and a little dry. One idea per post, usually a rule and then the reason for it. Threads are short lists of steps that end on what to do.',
  traits: [
    'Opens with the rule, then the reason',
    'Short declarative sentences',
    'Threads are numbered or listed steps',
    'Says when a tool is the wrong choice',
    'Plain words, no hype',
    'Ends on what the reader should do',
  ],
}

/** Ada's hand-written X history as a timeline: one post every day and a half, newest first, replies in between. */
function adaXHistory(now: number): ImportedPost[] {
  const originals = ADA_X_ORIGINALS.map((post) => ({ ...post, isReply: false }))
  const replies = ADA_X_REPLIES.map((post) => ({ ...post, isReply: true }))
  // A reply after every ninth original, so the timeline reads the way an account does.
  const timeline = originals.flatMap((post, index) => {
    const reply = index % 9 === 8 ? replies[(index - 8) / 9] : undefined
    return reply ? [post, reply] : [post]
  })
  return timeline.map((post, index) => ({
    externalId: `seed-ada-x-${index + 1}`,
    parts: post.parts,
    postedAt: now - Math.round((2 + index * 1.5) * 86_400_000) - ((index * 5) % 9) * 3_600_000,
    likes: post.likes,
    reposts: post.reposts,
    replies: post.replies,
    isReply: post.isReply,
    lang: 'en',
  }))
}

/**
 * The seeded image post's card, drawn like the runner's title card (near-white,
 * dark title, the handle under it) so the episode page shows a real preview.
 */
function seededCardSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">
  <rect width="1600" height="900" fill="#fafafa"/>
  <text x="800" y="450" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="73" font-weight="600" fill="#262626">${SEEDED_CARD_TITLE}</text>
  <text x="800" y="530" text-anchor="middle" font-family="ui-monospace, monospace" font-size="31" fill="#737373">Ada Automates · @ada.automates</text>
</svg>`
}

/**
 * A screenshot of an n8n error workflow, drawn for Ada's asset library: the
 * Error Trigger wired to a Slack alert on n8n's dotted canvas. The writer
 * places it in a beat that explains error workflows.
 */
function seededCanvasSvg(): string {
  const node = (x: number, label: string, detail: string, color: string) => `
  <rect x="${x}" y="370" width="340" height="160" rx="18" fill="#ffffff" stroke="#d4d4d4" stroke-width="3"/>
  <rect x="${x}" y="370" width="16" height="160" rx="8" fill="${color}"/>
  <text x="${x + 40}" y="440" font-family="Inter, system-ui, sans-serif" font-size="34" font-weight="600" fill="#262626">${label}</text>
  <text x="${x + 40}" y="485" font-family="ui-monospace, monospace" font-size="22" fill="#737373">${detail}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">
  <defs><pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="#e5e5e5"/></pattern></defs>
  <rect width="1600" height="900" fill="#fafafa"/>
  <rect width="1600" height="900" fill="url(#dots)"/>
  <text x="80" y="120" font-family="Inter, system-ui, sans-serif" font-size="40" font-weight="600" fill="#262626">Error workflow</text>
  <text x="80" y="170" font-family="ui-monospace, monospace" font-size="24" fill="#737373">Settings → Error workflow → this one</text>
  ${node(120, 'Error Trigger', 'on any failed run', '#e11d48')}
  <path d="M460 450 H 630" stroke="#a3a3a3" stroke-width="4" fill="none"/>
  ${node(630, 'Set message', 'workflow, node, error', '#0d9488')}
  <path d="M970 450 H 1140" stroke="#a3a3a3" stroke-width="4" fill="none"/>
  ${node(1140, 'Slack', '#alerts, once a run', '#7c3aed')}
</svg>`
}

/** Ada's brand notes, a document in her asset library: it stays in the library, a beat never shows it. */
const SEEDED_BRAND_NOTES = `Ada Automates, brand notes

Colours: paper background, teal accents, no gradients.
Screens: n8n at 125% zoom, dark mode off, the canvas tidied before recording.
Words: "you", never "guys". No "game changer", no "insane".
`

export const run = internalAction({
  args: { appUrl: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ workspaceId: Id<'workspaces'> }> => {
    // A tiny placeholder file stands in for every seeded video render, the rendered episode's publish package
    // included. It is not a playable video. The runner uploads real (mock) videos for anything it produces.
    const storageId = await ctx.storage.store(new Blob([new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70])], { type: 'video/mp4' }))
    const cardStorageId = await ctx.storage.store(new Blob([seededCardSvg()], { type: 'image/svg+xml' }))
    const canvasStorageId = await ctx.storage.store(new Blob([seededCanvasSvg()], { type: 'image/svg+xml' }))
    const brandStorageId = await ctx.storage.store(new Blob([SEEDED_BRAND_NOTES], { type: 'text/plain' }))
    return ctx.runMutation(internal.internal.seed.write, {
      storageId,
      cardStorageId,
      canvasStorageId,
      brandStorageId,
      appUrl: args.appUrl ?? 'http://localhost:3300',
    })
  },
})

export const write = internalMutation({
  args: {
    storageId: v.id('_storage'),
    cardStorageId: v.id('_storage'),
    canvasStorageId: v.id('_storage'),
    brandStorageId: v.id('_storage'),
    appUrl: v.string(),
  },
  handler: async (ctx, args): Promise<{ workspaceId: Id<'workspaces'> }> => {
    const existing = (await ctx.db.query('workspaces').collect()).find((workspace) => workspace.name === 'Formstep')
    if (existing) return { workspaceId: existing._id }
    const now = Date.now()
    const workspaceId = await ctx.db.insert('workspaces', {
      name: 'Formstep',
      sponsorName: 'Formstep',
      sponsorUrl: 'https://formstep.io',
      appUrl: args.appUrl,
      signInRequiredHosts: ['localhost:5678', 'app.formstep.io'],
      signedInHosts: [],
      valuePerPaid: 29,
      currency: 'EUR',
    })

    const adaId = await ctx.db.insert('personas', {
      workspaceId,
      name: 'Ada Automates',
      color: 'teal',
      handle: 'ada.automates',
      niche: 'n8n and workflow automation for small teams',
      tone: 'calm, precise, a little dry',
      bio: 'One n8n fix a day. No fluff, no plugins you do not need.',
      bible:
        'Ada speaks in short sentences and shows the screen before she explains it. She never says "game changer" or "insane". She admits when a tool is the wrong choice. She calls viewers "you", never "guys".',
      pillars: ['n8n tutorials', 'AI agent workflows', 'Automation fails'],
      formats: ADA_FORMATS,
      voiceId: 'mock-ada',
      sponsorDial: 0.4,
      sponsorRampEpisodes: 10,
      episodesPerWeek: 5,
      autoApprove: false,
      // Ada's rendered episodes wait as publish packages, so the demo shows one to approve.
      autoPublish: false,
      paused: false,
      timezone: TIMEZONE,
      createdAt: now - 40 * 86_400_000,
    })
    const maxId = await ctx.db.insert('personas', {
      workspaceId,
      name: 'Max Builds Agents',
      color: 'clay',
      handle: 'max.builds.agents',
      niche: 'Claude Code, MCP, and agents that do real work',
      tone: 'curious, fast, honest about failures',
      bio: 'I build an AI agent a week and show you where it broke.',
      bible:
        'Max narrates while the agent runs. Every episode ends with what he would do differently. He never promises an agent "just works". He says "the agent" not "the AI".',
      pillars: ['Claude Code recipes', 'MCP servers', 'Agents in production'],
      formats: MAX_FORMATS,
      voiceId: 'mock-max',
      sponsorDial: 0.3,
      sponsorRampEpisodes: 10,
      episodesPerWeek: 3,
      autoApprove: true,
      autoPublish: true,
      paused: false,
      timezone: TIMEZONE,
      createdAt: now - 10 * 86_400_000,
    })

    // Link-in-bio links.
    for (const personaId of [adaId, maxId]) {
      const persona = await ctx.db.get(personaId)
      if (!persona) throw new Error('persona vanished')
      await createTrackedLink(ctx, { persona, target: 'https://formstep.io' })
    }

    // Ada's asset library: a screenshot the writer can place, and a document that stays in the library.
    const seededAsset = async (
      storageId: Id<'_storage'>,
      asset: { kind: AssetKind; name: string; tags: string[]; note: string; daysAgo: number }
    ) => {
      const file = await ctx.db.system.get(storageId)
      if (!file) throw new Error(`seeded file ${storageId} is not in storage`)
      return ctx.db.insert('assets', {
        personaId: adaId,
        storageId,
        kind: asset.kind,
        name: asset.name,
        contentType: file.contentType ?? '',
        size: file.size,
        tags: asset.tags,
        note: asset.note,
        source: 'operator',
        createdAt: now - asset.daysAgo * DAY_MS,
      })
    }
    const canvasId = await seededAsset(args.canvasStorageId, {
      kind: 'image',
      name: 'Error workflow canvas',
      tags: ['error workflow', 'error trigger', 'canvas'],
      note: 'The Error Trigger wired to one Slack alert. Show it when a script explains error workflows.',
      daysAgo: 6,
    })
    await seededAsset(args.brandStorageId, {
      kind: 'document',
      name: 'Brand notes',
      tags: ['brand'],
      note: 'Colours, screens and words Ada keeps to.',
      daysAgo: 20,
    })

    await ctx.db.insert('directives', {
      personaId: adaId,
      text: 'focus on n8n error handling for two weeks',
      active: true,
      createdAt: now - 3 * 86_400_000,
    })
    await ctx.db.insert('messages', {
      personaId: adaId,
      author: 'operator',
      text: 'Focus on n8n error handling for two weeks',
      createdAt: now - 3 * 86_400_000,
    })
    await ctx.db.insert('messages', {
      personaId: adaId,
      author: 'persona',
      text: 'Noted. From now on: "focus on n8n error handling for two weeks". The next scripts follow it.',
      createdAt: now - 3 * 86_400_000 + 5_000,
    })

    // What the operator told Ada to keep: a fact from the chat, with the message as its evidence, and a
    // rule added on the memory page. The writer reads both before every script and post.
    const toldAt = now - 2 * 86_400_000
    const tellId = await ctx.db.insert('messages', {
      personaId: adaId,
      author: 'operator',
      text: "Remember that viewers hate the word 'guys'",
      createdAt: toldAt,
    })
    const told = await rememberFromOperator(
      ctx,
      { _id: adaId },
      { kind: 'fact', text: "viewers hate the word 'guys'", messageId: tellId, now: toldAt }
    )
    if (told.status !== 'stored') throw new Error(`the seeded fact was not stored: ${told.status}`)
    await ctx.db.insert('messages', {
      personaId: adaId,
      author: 'persona',
      text: `I will remember that: "${told.text}" I read what I know before every script and post.`,
      createdAt: toldAt + 3_000,
    })
    const ruled = await rememberFromOperator(
      ctx,
      { _id: adaId },
      { kind: 'rule', text: "never show a customer's real email address on screen", now: toldAt + 3_600_000 }
    )
    if (ruled.status !== 'stored') throw new Error(`the seeded rule was not stored: ${ruled.status}`)

    // Signals the researcher would have found, each with when it was found and, where its source says
    // so, when it was posted (Google Trends does not), so freshness reads like a real feed. Ada's three
    // comments ask one question in different words, so her problem log has one entry below; her search
    // suggestions and the one fresh Reddit thread are this morning's, and one Reddit thread went cold
    // under tomorrow's reactive idea. Max has no comments and no search suggestions.
    const seedSignals: {
      personaId: Id<'personas'>
      source: 'hackernews' | 'reddit' | 'google_trends' | 'comments' | 'search'
      title: string
      summary: string
      url: string
      score: number
      topics: string[]
      foundHoursAgo: number
      /** Absent where the source does not say when the item was posted. */
      publishedHoursAgo?: number
    }[] = [
      {
        personaId: adaId,
        source: 'reddit',
        title: 'n8n webhook fails silently when the client sends a form, how do I debug?',
        summary: 'r/n8n thread, 140 comments, most answers are about error workflows.',
        url: 'https://www.reddit.com/r/n8n/comments/example1',
        score: 92,
        topics: ['n8n', 'webhooks', 'debugging'],
        foundHoursAgo: 48,
        publishedHoursAgo: 50,
      },
      {
        personaId: adaId,
        source: 'hackernews',
        title: 'Ask HN: How do you get customer sign-off inside an automated pipeline?',
        summary: 'Thread about pausing workflows until a client approves a quote.',
        url: 'https://news.ycombinator.com/item?id=1',
        score: 81,
        topics: ['workflows', 'approvals', 'customers'],
        foundHoursAgo: 30,
        publishedHoursAgo: 40,
      },
      {
        personaId: adaId,
        source: 'google_trends',
        title: 'n8n vs make',
        summary: 'Breakout query in the last 30 days.',
        url: 'https://trends.google.com/trends/explore?q=n8n%20vs%20make',
        score: 64,
        topics: ['n8n', 'make', 'comparison'],
        foundHoursAgo: 10,
      },
      {
        personaId: adaId,
        source: 'comments',
        title: 'Can you show how to retry a failed webhook step?',
        summary: 'Asked under last week’s episode, 12 likes.',
        url: 'https://youtube.com/watch?v=mock',
        score: 70,
        topics: ['n8n', 'webhooks'],
        foundHoursAgo: 118,
        publishedHoursAgo: 120,
      },
      {
        personaId: maxId,
        source: 'hackernews',
        title: 'Claude Code and MCP: the agent that files its own tickets',
        summary: 'MCP servers that let an agent act on real tools, with a long comment thread on safety.',
        url: 'https://news.ycombinator.com/item?id=2',
        score: 95,
        topics: ['ai agents', 'mcp', 'claude'],
        foundHoursAgo: 15,
        publishedHoursAgo: 20,
      },
      {
        personaId: maxId,
        source: 'google_trends',
        title: 'ai agents tutorial',
        summary: 'Rising query, +140% over 90 days.',
        url: 'https://trends.google.com/trends/explore?q=ai%20agents%20tutorial',
        score: 77,
        topics: ['ai agents', 'tutorial'],
        foundHoursAgo: 25,
      },
      {
        personaId: adaId,
        source: 'comments',
        title: 'How do I retry a failed webhook step in n8n?',
        summary: 'Asked under "Error workflows that page you only once", 8 likes.',
        url: 'https://youtube.com/watch?v=mock',
        score: 64,
        topics: ['n8n', 'webhooks'],
        foundHoursAgo: 70,
        publishedHoursAgo: 72,
      },
      {
        personaId: adaId,
        source: 'comments',
        title: 'Is there a way to retry the failed webhook step?',
        summary: 'Asked under "Debug a webhook that fails silently", 5 likes.',
        url: 'https://tiktok.com/@ada.automates/video/mock',
        score: 58,
        topics: ['n8n', 'webhooks'],
        foundHoursAgo: 18,
        publishedHoursAgo: 20,
      },
      {
        personaId: adaId,
        source: 'search',
        title: 'n8n error workflow',
        summary: 'People type "n8n error workflow" into Google.',
        url: 'https://www.google.com/search?q=n8n%20error%20workflow',
        score: 70,
        topics: ['n8n', 'error', 'workflow'],
        foundHoursAgo: 2,
        publishedHoursAgo: 2,
      },
      {
        personaId: adaId,
        source: 'search',
        title: 'how to retry n8n webhook',
        summary: 'People type "how to retry n8n webhook" into Google.',
        url: 'https://www.google.com/search?q=how%20to%20retry%20n8n%20webhook',
        score: 65,
        topics: ['n8n', 'webhooks'],
        foundHoursAgo: 2,
        publishedHoursAgo: 2,
      },
      {
        personaId: adaId,
        source: 'search',
        title: 'n8n vs zapier for agencies',
        summary: 'People type "n8n vs zapier for agencies" into Google.',
        url: 'https://www.google.com/search?q=n8n%20vs%20zapier%20for%20agencies',
        score: 60,
        topics: ['n8n', 'zapier', 'comparison'],
        foundHoursAgo: 2,
        publishedHoursAgo: 2,
      },
      {
        personaId: adaId,
        source: 'reddit',
        title: 'n8n queue mode for webhooks: is it worth turning on?',
        summary: 'r/n8n thread from this morning, 60 comments and climbing.',
        url: 'https://www.reddit.com/r/n8n/comments/example2',
        score: 88,
        topics: ['n8n', 'webhooks'],
        foundHoursAgo: 2,
        publishedHoursAgo: 3,
      },
      {
        personaId: adaId,
        source: 'reddit',
        title: 'n8n credentials vanished after the 1.0 upgrade',
        summary: 'r/n8n thread from ten days ago; the fix shipped the day after.',
        url: 'https://www.reddit.com/r/n8n/comments/example3',
        score: 85,
        topics: ['n8n', 'upgrades'],
        foundHoursAgo: 238,
        publishedHoursAgo: 240,
      },
    ]
    const signalIds: Id<'signals'>[] = []
    for (const [index, signal] of seedSignals.entries()) {
      const { foundHoursAgo, publishedHoursAgo, ...row } = signal
      signalIds.push(
        await ctx.db.insert('signals', {
          ...row,
          externalId: `seed-${index}`,
          status: 'new',
          foundAt: now - foundHoursAgo * HOUR_MS,
          ...(publishedHoursAgo === undefined ? {} : { publishedAt: now - publishedHoursAgo * HOUR_MS }),
          mock: true,
        })
      )
    }
    /** A seeded signal by its place in the list above; a missing one is a bug in the seed. */
    const seededSignal = (index: number): Id<'signals'> => {
      const id = signalIds[index]
      if (id === undefined) throw new Error(`the seed has no signal ${index}`)
      return id
    }

    // The code the operator handed Ada a month ago: every description since carries it. Its redemptions
    // are the ones the mock billing provider will report on the first pull, same order ids, so the pull
    // dedupes against these rows instead of counting them again.
    const adaCodeCreatedAt = now - 30 * 86_400_000
    const adaCodeId = await ctx.db.insert('discountCodes', {
      personaId: adaId,
      code: 'ADA20',
      offer: '20% off Pro for 3 months',
      active: true,
      redemptions: 0,
      createdAt: adaCodeCreatedAt,
    })
    const adaCode = await ctx.db.get(adaCodeId)
    if (!adaCode) throw new Error('discount code vanished')
    const redeemed = await mockDiscounts.redemptions({ code: adaCode.code, since: adaCodeCreatedAt })
    for (const redemption of redeemed) {
      await ctx.db.insert('conversions', {
        personaId: adaId,
        kind: 'paid',
        via: 'code',
        distinctId: redemption.orderId,
        at: redemption.at,
        mock: true,
      })
    }
    await ctx.db.patch(adaCodeId, { redemptions: redeemed.length })

    // History: Ada's last four weeks, published and measured, so the report has a funnel. Every episode
    // went to all of Ada's platforms, each at its own hour, in the format her platforms resolve to.
    const ada = await ctx.db.get(adaId)
    const workspace = await ctx.db.get(workspaceId)
    if (!ada || !workspace) throw new Error('seed rows vanished')
    const adaPlatforms = platformsOf(ada)
    const adaFormats = formatsFor(ada, adaPlatforms)
    const adaFormat = resolveEpisodeFormat(adaFormats)
    const adaAspects = formatAspects(adaFormat)
    // No seeded episode carries a publish time variant, so each platform goes out at its own hour (offset 0).
    const platformInstant = (day: string, format: PlatformFormat) => instantAt(day, publishHourFor(format, 0), TIMEZONE)
    const adaRenders = (durationSec: number) => adaAspects.map((aspect) => ({ aspect, storageId: args.storageId, durationSec, mock: true }))
    const today = dayKey(now, TIMEZONE)
    /**
     * One of Ada's past videos, live on every platform at its own hour: a tracked link per platform with its
     * clicks (none on X, where nothing is appended), and three snapshots per publication.
     */
    const seedPastVideo = async (video: {
      concept: string
      pillar: string
      sponsorSegment: SponsorSegment
      plannedFor: string
      experimentId: Id<'experiments'>
      variantKey: string
      hook: string
      closing: string
      /** Measured, or still only published (the newest). */
      measured: boolean
      /** Tells the seeded videos' slugs, external ids and view counts apart. */
      tag: string
      viewSeed: number
      /** Clicks per base view on every platform but X. */
      clickRate: number
      /** The clicks come over this many hours after a publication goes live. */
      clickHours: number
      /** Hours after a publication went live of its snapshots; the seed never writes one after now. */
      snapshotHours: (liveAt: number) => number[]
    }): Promise<{ episodeId: Id<'episodes'>; scheduledAt: number; clicks: number }> => {
      // No seeded episode carries a publish time variant, so every one goes out at its platforms' own hours.
      const scheduledAt = earliestPublishAt(ada, adaPlatforms, video.plannedFor, 0)
      // Live once the last platform went out.
      const publishedAt = Math.max(...adaFormats.map((format) => platformInstant(video.plannedFor, format)))
      const shotPlan = seededBeats({
        hook: video.hook,
        opener: { title: 'The hook', tool: PRESENTER_TOOL, url: '' },
        fix: 'Step one, open n8n and find the node that fails. Step two, add an error workflow and a retry.',
        sponsorSegment: video.sponsorSegment,
        sponsorName: workspace.sponsorName,
        sponsorUrl: workspace.sponsorUrl,
        closing: video.closing,
      })
      const description = seededDescription(video.concept)
      const episodeId = await ctx.db.insert('episodes', {
        personaId: adaId,
        slug: `${video.concept
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60)}-${video.tag}`,
        kind: 'video',
        status: video.measured ? 'measured' : 'published',
        concept: video.concept,
        title: video.concept,
        hook: hookOf(shotPlan),
        description,
        sponsorSegment: video.sponsorSegment,
        platforms: adaPlatforms,
        format: adaFormat,
        shotPlan,
        shots: shotsFromDraft({ shotPlan }, workspace.sponsorName, adaFormat.delivery),
        renders: adaRenders(58),
        plannedFor: video.plannedFor,
        scheduledAt,
        experimentId: video.experimentId,
        variantKey: video.variantKey,
        signalIds: [],
        pillar: video.pillar,
        approvedAt: scheduledAt - DAY_MS,
        publishedAt,
        measuredAt: video.measured ? publishedAt + 72 * 3_600_000 : undefined,
        createdAt: scheduledAt - 2 * DAY_MS,
        updatedAt: publishedAt,
      })
      const episode = await ctx.db.get(episodeId)
      if (!episode) throw new Error('episode vanished')
      let clicksTotal = 0
      for (const format of adaFormats) {
        const { platform } = format
        const liveAt = platformInstant(video.plannedFor, format)
        const linkId = await createTrackedLink(ctx, { persona: ada, episode, platform, target: workspace.sponsorUrl })
        const externalId = `mock-${platform}-${video.tag}`
        // Off X each went out with Ada's description and her code, stamped at dispatch; X took the title alone.
        const publicationId = await ctx.db.insert('publications', {
          episodeId,
          personaId: adaId,
          platform,
          aspect: format.aspect,
          status: 'live',
          title: video.concept,
          body: platform === 'x' ? undefined : description,
          discountCodeId: platform === 'x' ? undefined : adaCode._id,
          linkId,
          scheduledAt: liveAt,
          externalId,
          url: mockPublicationUrl(platform, externalId),
          publishedAt: liveAt,
          mock: true,
        })
        const platformFactor = platform === 'tiktok' ? 2.4 : platform === 'instagram' ? 1.3 : 1
        const baseViews = Math.round((900 + ((video.viewSeed * 131) % 700)) * platformFactor)
        // Nothing is appended on X, so its tracked link is never printed and never clicked.
        const clicks = platform === 'x' ? 0 : Math.round(baseViews * video.clickRate)
        for (let c = 0; c < clicks; c += 1) {
          await ctx.db.insert('linkClicks', {
            linkId,
            personaId: adaId,
            episodeId,
            at: liveAt + ((c + 1) * video.clickHours * 3_600_000) / (clicks + 1),
          })
        }
        await ctx.db.patch(linkId, { clicks })
        clicksTotal += clicks
        for (const [snapshotIndex, hours] of video.snapshotHours(liveAt).entries()) {
          const views = Math.round(baseViews * Math.log2(2 + hours) * 0.4)
          await ctx.db.insert('metricSnapshots', {
            personaId: adaId,
            episodeId,
            publicationId,
            platform,
            takenAt: Math.min(now, liveAt + hours * 3_600_000) - snapshotIndex,
            counts: {
              views,
              watchRate: 0.42,
              follows: Math.round(views * 0.012),
              likes: Math.round(views * 0.06),
              comments: Math.round(views * 0.004),
              clicks: Math.round(clicks * Math.min(1, hours / 96)),
              signups: 0,
              paid: 0,
            },
            mock: true,
          })
        }
      }
      return { episodeId, scheduledAt, clicks: clicksTotal }
    }

    // September, before the Confession hooks: the experiment Ada's analyst picked that made "Comment" her
    // call to action. Four videos ran it on every platform; its decision comes from their numbers through
    // the daily evaluation's own rules (core variantStatsFor, shared decideExperiment) and lands through core
    // applyExperimentDecision, so its card, the learning, the journal entry and the default agree. The clicks
    // came within a day and the last snapshot four days after each video went live, so none of it falls in
    // the report's 28-day trend or the mock analytics' 30-day window.
    const follow = catalogVariant('cta', 'follow')
    const comment = catalogVariant('cta', 'comment')
    const ctaExperimentId = await startExperiment(
      ctx,
      ada,
      {
        name: `Call to action: ${comment.label} vs ${follow.label}`,
        hypothesis: `"${comment.label}" (end with a question for the comments) gets more clicks per view than "${follow.label}" (end by asking the viewer to follow for the next one).`,
        kind: 'cta',
        metric: 'clicks',
        variants: [
          { ...follow, isControl: true },
          { ...comment, isControl: false },
        ],
        minExposures: METRIC_MIN_EXPOSURES.views,
        minConfidence: AUTO_MIN_CONFIDENCE,
        createdBy: 'analyst',
        reason:
          'Call to action was never tested. It aims at clicks per view, the step closest to paying customers with enough clicks to measure.',
      },
      now - 41 * DAY_MS
    )
    const ctaConcepts = [
      ['Name every n8n node before the workflow grows', 'n8n tutorials', 'follow'],
      ['An agent that files invoices into the right folder', 'AI agent workflows', 'comment'],
      ['The cron job that ran in the wrong timezone', 'Automation fails', 'follow'],
      ['Split a long n8n workflow into sub-workflows', 'n8n tutorials', 'comment'],
    ] as const
    for (const [index, [concept, pillar, variantKey]] of ctaConcepts.entries()) {
      await seedPastVideo({
        concept,
        pillar,
        sponsorSegment: 'none',
        plannedFor: addDays(today, -(38 - index * 2)),
        experimentId: ctaExperimentId,
        variantKey,
        hook: `How to ${concept.toLowerCase()} in under a minute.`,
        closing: SEEDED_CLOSINGS[variantKey],
        measured: true,
        tag: `c${index}`,
        viewSeed: index + 11,
        clickRate: variantKey === 'comment' ? 0.016 : 0.011,
        clickHours: 20,
        snapshotHours: () => [24, 72, 96],
      })
    }
    const ctaExperiment = await ctx.db.get(ctaExperimentId)
    if (!ctaExperiment) throw new Error('experiment vanished')
    const ctaStats = await variantStatsFor(ctx, ctaExperiment)
    const ctaDecision = decideExperiment(ctaStats, { minExposures: ctaExperiment.minExposures, minConfidence: ctaExperiment.minConfidence })
    if (ctaDecision?.winnerKey !== comment.key) throw new Error('the seeded call to action experiment must decide for "Comment"')
    // The same order decideExperiment ranks by, so the runner-up is the variant the winner was tested against.
    const [ctaWinner, ctaRunnerUp] = [...ctaStats].sort((a, b) => variantRate(b) - variantRate(a))
    if (!ctaWinner || !ctaRunnerUp) throw new Error('the seeded call to action experiment has no runner-up')
    await applyExperimentDecision(
      ctx,
      ctaExperiment,
      { ...ctaDecision, winnerRate: variantRate(ctaWinner), runnerUpRate: variantRate(ctaRunnerUp), runnerUpKey: ctaRunnerUp.key },
      'analyst',
      analystDecisionNote(ctaExperiment, ctaDecision),
      now - 28 * DAY_MS
    )

    // The operator's own experiment, running since: confession hooks against Ada's how-to hooks.
    const experimentId = await startExperiment(
      ctx,
      ada,
      {
        name: 'Confession hooks',
        hypothesis: '"I was wrong about…" hooks beat "How to…" hooks on click rate.',
        kind: 'hook',
        metric: 'clicks',
        variants: [
          { key: 'howto', label: 'How to…', description: 'Open with "How to <do the thing> in under a minute."', isControl: true },
          {
            key: 'wrong',
            label: 'I was wrong about…',
            description: 'Open with a confession: "I was wrong about <the thing>."',
            isControl: false,
          },
        ],
        minExposures: 2000,
        minConfidence: 0.9,
        createdBy: 'operator',
        reason: '"I was wrong about…" hooks beat "How to…" hooks on click rate.',
      },
      now - 27 * DAY_MS
    )

    // Since September every video closes on a question for the comments, Ada's call to action now.
    const historyConcepts = [
      ['Retry a failed n8n webhook without losing the payload', 'n8n tutorials', 'none', 'howto'],
      ['Three n8n error workflows every team needs', 'n8n tutorials', 'none', 'wrong'],
      ['An AI agent that triages support email in n8n', 'AI agent workflows', 'none', 'howto'],
      ['The automation that emailed 400 customers twice', 'Automation fails', 'none', 'wrong'],
      ['Pause a workflow until the customer signs off', 'AI agent workflows', 'mention', 'howto'],
      ['Collect documents from clients without chasing emails', 'n8n tutorials', 'demo', 'wrong'],
      ['n8n vs Make for a five-person team', 'n8n tutorials', 'none', 'howto'],
      ['Agent that fills in a quote and waits for approval', 'AI agent workflows', 'demo', 'wrong'],
    ] as const
    const history: { episodeId: Id<'episodes'>; variantKey: string; scheduledAt: number; clicks: number }[] = []
    for (const [index, [concept, pillar, sponsorSegment, variantKey]] of historyConcepts.entries()) {
      const plannedFor = addDays(today, -(26 - index * 3))
      const seeded = await seedPastVideo({
        concept,
        pillar,
        sponsorSegment,
        plannedFor,
        experimentId,
        variantKey,
        hook: variantKey === 'wrong' ? `I was wrong about ${concept.toLowerCase()}.` : `How to ${concept.toLowerCase()} in under a minute.`,
        closing: SEEDED_CLOSINGS.comment,
        measured: index !== historyConcepts.length - 1,
        tag: `s${index}`,
        viewSeed: index,
        clickRate: variantKey === 'wrong' ? 0.021 : 0.014,
        clickHours: 60,
        // The day after, three days after, and now.
        snapshotHours: (liveAt) => [24, 72, Math.max(96, (now - liveAt) / 3_600_000)],
      })
      history.push({ ...seeded, variantKey })
    }

    // Conversions exactly as the mock analytics will report them on the first pull, same distinct ids,
    // so the pull dedupes against these rows. The mock ties nothing to an episode (its UTM carries no
    // campaign); the seed spreads its rows over the episodes in proportion to clicks and times each one
    // after its episode went live, so the report has value per episode and the trend clusters on publish days.
    const totalClicks = history.reduce((sum, row) => sum + row.clicks, 0)
    const found = await mockAnalytics.conversions({ personaHandle: ada.handle, since: now - 30 * 86_400_000, clicksSince: totalClicks })
    const demos = found.filter((conversion) => conversion.kind === 'demo_started')
    // A journey is one person's signup and what followed it, in the mock's own timing.
    const journeys: FoundConversion[][] = []
    for (const conversion of found) {
      if (conversion.kind === 'demo_started') continue
      const journey = journeys.find((steps) => steps[0]?.distinctId === conversion.distinctId)
      if (journey) journey.push(conversion)
      else journeys.push([conversion])
    }
    const upTo = (count: number, clicks: number) => (totalClicks === 0 ? 0 : Math.round((count * clicks) / totalClicks))
    let clicksBefore = 0
    for (const row of history) {
      const from = clicksBefore
      clicksBefore += row.clicks
      const base = { personaId: adaId, episodeId: row.episodeId, variantKey: row.variantKey, via: 'utm' as const, mock: true }
      for (const [k, demo] of demos.slice(upTo(demos.length, from), upTo(demos.length, clicksBefore)).entries()) {
        await ctx.db.insert('conversions', {
          ...base,
          kind: demo.kind,
          distinctId: demo.distinctId,
          at: row.scheduledAt + (k + 1) * 3 * 3_600_000,
        })
      }
      for (const [k, journey] of journeys.slice(upTo(journeys.length, from), upTo(journeys.length, clicksBefore)).entries()) {
        const [first] = journey
        if (!first) continue
        const signedUpAt = row.scheduledAt + (k + 1) * 7 * 3_600_000
        for (const step of journey) {
          await ctx.db.insert('conversions', {
            ...base,
            kind: step.kind,
            distinctId: step.distinctId,
            at: signedUpAt + (step.at - first.at),
          })
        }
      }
    }

    // Ada's weekly review a week ago, through the review's own rules: with the confession hooks running it
    // starts nothing, and it moves pillar weight toward what her measured videos earned.
    const reviewed = await ctx.db.get(adaId)
    if (!reviewed) throw new Error('persona vanished')
    await reviewStrategy(ctx, reviewed, now - 6 * DAY_MS)

    // This week: one episode at each of the remaining statuses, so the calendar shows the whole pipeline.
    // Every one is scripted or later, so it carries Ada's resolved format, her description and the beats
    // its shots came from. A script is written the day before its episode goes out, so nothing scripted
    // sits more than a day out: a status whose weekday is later this week moves to today (one the
    // operator or the runner works on now) or tomorrow (one waiting to go out). The rendered one waits
    // tomorrow as a publish package, its drafts unsent.
    const monday = weekStart(today)
    const tomorrow = addDays(today, 1)
    const notLaterThan = (day: string, latest: string) => (day > latest ? latest : day)
    // The publish package the chat below moved; its id links the persona's reply.
    let renderedEpisodeId: Id<'episodes'> | null = null
    // The scripted retry episode, which answers the question the problem log records below.
    let retryEpisodeId: Id<'episodes'> | null = null
    const thisWeek = [
      {
        day: addDays(monday, 0),
        status: 'failed',
        concept: 'Debug a webhook that fails silently',
        error: 'produce: n8n at localhost:5678 did not answer within 30s',
      },
      {
        day: notLaterThan(addDays(monday, 1), tomorrow),
        status: 'scripted',
        concept: 'Retry a failed webhook step without losing the payload',
      },
      { day: notLaterThan(addDays(monday, 2), today), status: 'waiting_on_you', concept: 'Error workflows that page you only once' },
      { day: notLaterThan(addDays(monday, 3), today), status: 'recording', concept: 'An agent that drafts the reply and waits for you' },
      { day: notLaterThan(addDays(monday, 4), tomorrow), status: 'scheduled', concept: 'Pause a workflow until the customer signs off' },
      { day: tomorrow, status: 'rendered', concept: 'Send the quote and wait for the customer in n8n' },
    ] as const
    const scheduledDay = thisWeek[4].day
    for (const [index, item] of thisWeek.entries()) {
      const scheduledAt = earliestPublishAt(ada, adaPlatforms, item.day, 0)
      const sponsorSegment = index === 4 ? 'mention' : 'none'
      // Two beats, the problem in a browser and the fix in n8n, so the shots are Ada and then her screen.
      const variantKey = index % 2 === 0 ? 'howto' : 'wrong'
      // Each hook follows the episode's Confession hooks variant, and every closing Ada's call to action.
      const shotPlan = seededBeats({
        hook:
          variantKey === 'wrong'
            ? `I was wrong about ${item.concept.toLowerCase()}.`
            : `How to ${item.concept.toLowerCase()} in under a minute.`,
        opener: { title: 'The problem', tool: 'browser', url: 'https://news.ycombinator.com' },
        fix: 'Step one, open the tool. Step two, fix it the plain way.',
        sponsorSegment,
        sponsorName: workspace.sponsorName,
        sponsorUrl: workspace.sponsorUrl,
        closing: SEEDED_CLOSINGS.comment,
        // The error workflow episode shows the canvas screenshot, so its page names the asset its fix beat shows.
        fixAssetId: index === 2 ? canvasId : undefined,
      })
      const description = seededDescription(item.concept)
      const episodeId = await ctx.db.insert('episodes', {
        personaId: adaId,
        slug: `${item.concept
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .slice(0, 60)}-w${index}`,
        kind: 'video',
        status: item.status,
        concept: item.concept,
        title: item.concept,
        hook: hookOf(shotPlan),
        description,
        sponsorSegment,
        platforms: adaPlatforms,
        format: adaFormat,
        shotPlan,
        shots: shotsFromDraft({ shotPlan }, workspace.sponsorName, adaFormat.delivery),
        renders: item.status === 'scheduled' || item.status === 'rendered' ? adaRenders(55) : [],
        plannedFor: item.day,
        scheduledAt,
        experimentId,
        variantKey,
        signalIds: index === 1 ? [seededSignal(0)] : [],
        pillar: 'n8n tutorials',
        error: 'error' in item ? item.error : undefined,
        approvedAt: item.status === 'scripted' ? undefined : now - 3_600_000,
        createdAt: now - 2 * 86_400_000,
        updatedAt: now - 3_600_000,
      })
      if (item.status === 'rendered') renderedEpisodeId = episodeId
      if (item.status === 'scripted') retryEpisodeId = episodeId
      if (item.status === 'waiting_on_you') {
        await ctx.db.insert('checklistItems', {
          personaId: adaId,
          episodeId,
          title: "Sign in to localhost:5678 in the runner's browser",
          why: `"${item.concept}" records a screen on localhost:5678. The producer uses your signed-in session and never stores the password.`,
          status: 'open',
          action: { kind: 'open_browser', url: 'http://localhost:5678' },
          createdAt: now - 3_600_000,
        })
      }
      if (item.status === 'scheduled' || item.status === 'rendered') {
        const episode = await ctx.db.get(episodeId)
        if (!episode) throw new Error('episode vanished')
        // The scheduled episode's package was approved, so its publications are queued; the rendered one's
        // wait as drafts. Either way the footer and Ada's code are added at dispatch, never stored here.
        for (const format of adaFormats) {
          const { platform } = format
          const linkId = await createTrackedLink(ctx, { persona: ada, episode, platform, target: workspace.sponsorUrl })
          await ctx.db.insert('publications', {
            episodeId,
            personaId: adaId,
            platform,
            aspect: format.aspect,
            status: item.status === 'scheduled' ? 'queued' : 'draft',
            title: item.concept,
            body: platform === 'x' ? undefined : description,
            linkId,
            scheduledAt: platformInstant(item.day, format),
            mock: true,
          })
        }
      }
      if (item.status === 'recording') {
        const episode = await ctx.db.get(episodeId)
        if (!episode) throw new Error('episode vanished')
        await enqueueJob(ctx, {
          kind: 'produce',
          personaId: adaId,
          episodeId,
          payload: {
            kind: 'video',
            episodeId,
            personaHandle: ada.handle,
            voiceId: ada.voiceId,
            shots: episode.shots,
            aspects: adaAspects,
            assets: [],
          } satisfies ProducePayload,
        })
      }
    }
    await ctx.db.patch(seededSignal(0), { status: 'used' })

    // Tomorrow's reactive idea, built on a Reddit thread ten days old: its signal went cold, so when
    // `writeDueScripts` queues its script, the last check swaps the concept for the freshest new signal
    // and journals why. Inserted as the planner left it, with no write job, so the swap waits for that run.
    const coldSignal = await ctx.db.get(seededSignal(12))
    if (!coldSignal) throw new Error('the cold signal vanished')
    const coldConcept = signalConcept(coldSignal.title)
    await ctx.db.insert('episodes', {
      personaId: adaId,
      slug: 'react-to-n8n-credentials-vanished-cold',
      kind: 'video',
      status: 'idea',
      concept: coldConcept,
      title: coldConcept,
      hook: '',
      sponsorSegment: 'none',
      platforms: adaPlatforms,
      shots: [],
      renders: [],
      plannedFor: tomorrow,
      scheduledAt: earliestPublishAt(ada, adaPlatforms, tomorrow, 0),
      signalIds: [coldSignal._id],
      pillar: 'Automation fails',
      createdAt: now - 6 * DAY_MS,
      updatedAt: now - 6 * DAY_MS,
    })
    await ctx.db.patch(coldSignal._id, { status: 'used' })

    // Later this week and next: ideas only, waiting for the day before they go out.
    for (const [offset, concept, pillar] of [
      [3, 'Catch a stuck execution before the customer does', 'Automation fails'],
      [5, 'Let an agent sort the inbox, then ask before it replies', 'AI agent workflows'],
    ] as const) {
      await createIdea(ctx, ada, {
        kind: 'video',
        personaId: adaId,
        plannedFor: addDays(today, offset),
        concept,
        pillar,
        sponsorSegment: 'none',
        signalIds: [],
      })
    }

    // This morning's research: the repeated question first, so the brief lists it among the open problems.
    // The scripted retry episode already answers that question, so it takes the candidate as one of its
    // signals, and the candidate is used rather than a concept for a second episode on it: the last check
    // before tomorrow's cold idea is written takes the fresh Reddit thread.
    if (retryEpisodeId === null) throw new Error('the scripted retry episode was not seeded')
    const retryEpisode = await ctx.db.get(retryEpisodeId)
    if (!retryEpisode) throw new Error('the scripted retry episode vanished')
    for (const problemId of await logRepeatedQuestions(ctx, ada, now)) {
      const candidate = await ctx.db
        .query('signals')
        .withIndex('by_persona_external', (q) => q.eq('personaId', adaId).eq('source', 'problems').eq('externalId', problemId))
        .unique()
      if (!candidate) throw new Error(`problem ${problemId} has no candidate signal`)
      await ctx.db.patch(candidate._id, { status: 'used' })
      await ctx.db.patch(retryEpisode._id, { signalIds: [...retryEpisode.signalIds, candidate._id] })
    }
    await writeDailyBrief(ctx, ada, now)

    // Ada's chat since the directive: a plan change the persona made and a task the researcher answered,
    // so the chat shows a linked episode and a finished task, and the Agents page has a finished job.
    if (renderedEpisodeId === null) throw new Error('the rendered episode was not seeded')
    const movedTo = tomorrow
    // A day of the same week, since a chat move stays in the episode's own week.
    const movedFrom = weekdayOf(movedTo) === 'monday' ? addDays(movedTo, 1) : addDays(movedTo, -1)
    const movedTitle = 'Send the quote and wait for the customer in n8n'
    await ctx.db.insert('messages', {
      personaId: adaId,
      author: 'operator',
      text: `Move the quote one to ${WEEKDAY_LABELS[weekdayOf(movedTo)]}`,
      createdAt: now - 26 * 3_600_000,
    })
    await ctx.db.insert('messages', {
      personaId: adaId,
      author: 'persona',
      text: `Moved "${movedTitle}" from ${WEEKDAY_LABELS[weekdayOf(movedFrom)]} to ${WEEKDAY_LABELS[weekdayOf(movedTo)]}.`,
      episodeId: renderedEpisodeId,
      createdAt: now - 26 * 3_600_000 + 4_000,
    })
    const askedAt = now - 2 * 3_600_000
    const askId = await ctx.db.insert('messages', {
      personaId: adaId,
      author: 'operator',
      text: 'Research brief on customer sign-off',
      createdAt: askedAt,
    })
    const briefJobId = await ctx.db.insert('jobs', {
      kind: 'research_brief',
      role: 'researcher',
      runsOn: 'backend',
      status: 'done',
      personaId: adaId,
      messageId: askId,
      payload: { personaId: adaId, topic: 'customer sign-off', messageId: askId },
      attempts: 1,
      createdAt: askedAt + 3_000,
      startedAt: askedAt + 4_000,
      finishedAt: askedAt + 40_000,
    })
    await ctx.db.insert('messages', {
      personaId: adaId,
      author: 'persona',
      text: 'Asked the researcher for a research brief on customer sign-off. It lands here when it is done.',
      jobId: briefJobId,
      createdAt: askedAt + 3_000,
    })
    const briefId = await ctx.db.insert('messages', {
      personaId: adaId,
      author: 'persona',
      text: `1 signal on customer sign-off: an Ask HN thread on getting customer sign-off inside an automated pipeline (score 81), mostly about pausing a workflow until the client approves a quote. That is ${WEEKDAY_LABELS[weekdayOf(scheduledDay)]}'s episode; a follow-up on reminding a customer who has not signed would fit next week.`,
      jobId: briefJobId,
      createdAt: askedAt + 40_000,
    })
    await ctx.db.patch(briefJobId, { result: { messageId: briefId } })

    // Ada on X: the label and connect items a persona gets when it gains X, and one post of each kind.
    // A text post waits for approval, a thread went live two days ago, and an image post's card is
    // rendered and queued. Each sits at one of the day's post slots.
    await openXChecklist(ctx, ada)
    const [firstSlot, secondSlot] = postSlotHours(formatFor(ada, 'x'))
    if (firstSlot === undefined || secondSlot === undefined) throw new Error("Ada's X cadence has fewer than two posts a day")
    const seedPost = async (post: {
      kind: PostKind
      intent: PostIntent
      status: 'scripted' | 'scheduled' | 'published'
      day: string
      hour: number
      concept: string
      sponsorSegment: 'none' | 'mention'
      written: EpisodePost
    }) => {
      const scheduledAt = instantAt(post.day, post.hour, TIMEZONE)
      const episodeId = await ctx.db.insert('episodes', {
        personaId: adaId,
        slug: `${post.concept
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60)}-p`,
        kind: post.kind,
        intent: post.intent,
        length: postLengthOf(post.written.parts),
        status: post.status,
        concept: post.concept,
        title: post.concept,
        hook: postHook(post.written.parts),
        post: post.written,
        sponsorSegment: post.sponsorSegment,
        platforms: ['x'],
        shots: [],
        renders: post.kind === 'image' ? [{ aspect: X_IMAGE_ASPECT, storageId: args.cardStorageId, durationSec: 0, mock: true }] : [],
        plannedFor: post.day,
        scheduledAt,
        signalIds: [],
        pillar: 'n8n tutorials',
        approvedAt: post.status === 'scripted' ? undefined : scheduledAt - 86_400_000,
        publishedAt: post.status === 'published' ? scheduledAt : undefined,
        createdAt: scheduledAt - 2 * 86_400_000,
        updatedAt: post.status === 'published' ? scheduledAt : now - 3_600_000,
      })
      const episode = await ctx.db.get(episodeId)
      if (!episode) throw new Error('episode vanished')
      return episode
    }
    await seedPost({
      kind: 'text',
      intent: 'inform',
      status: 'scripted',
      day: addDays(today, 1),
      hour: firstSlot,
      concept: 'n8n retries a failed node three times by default',
      sponsorSegment: 'none',
      written: {
        parts: [
          'n8n retries a failed node three times by default.\n\nThat is fine for a flaky API. It is wrong for a payment call: three retries can mean three charges. Turn retries off on any node that moves money, and send the failure to an error workflow instead.',
        ],
      },
    })
    const thread = await seedPost({
      kind: 'thread',
      intent: 'teach',
      status: 'published',
      day: addDays(today, -2),
      hour: firstSlot,
      concept: 'Get a customer sign-off inside an n8n workflow',
      sponsorSegment: 'mention',
      written: {
        parts: [
          'Your workflow needs a yes from the customer before it goes on. Here is how to wait for it without polling.',
          'Send the customer a request with the quote in it. Formstep gives you a link and calls your webhook with the answer.',
          'In n8n, end the first workflow there. A second workflow starts on the webhook and reads the answer.',
          'Approve goes on to the invoice. Reject goes back to the quote. Nothing sleeps, nothing polls.',
        ],
      },
    })
    const threadPublicationId = await createPostPublication(ctx, thread, ada, { mock: true, status: 'queued' })
    const threadExternalId = 'mock-x-thread'
    await ctx.db.patch(threadPublicationId, {
      status: 'live',
      externalId: threadExternalId,
      url: mockPublicationUrl('x', threadExternalId),
      publishedAt: thread.scheduledAt,
    })
    const threadViews = 4_200
    await ctx.db.insert('metricSnapshots', {
      personaId: adaId,
      episodeId: thread._id,
      publicationId: threadPublicationId,
      platform: 'x',
      takenAt: Math.min(now, thread.scheduledAt + 24 * 3_600_000),
      // X reports impressions; they fill views. A post has nothing to watch.
      counts: {
        views: threadViews,
        watchRate: 0,
        follows: Math.round(threadViews * 0.004),
        likes: Math.round(threadViews * 0.03),
        comments: Math.round(threadViews * 0.003),
        clicks: 0,
        signups: 0,
        paid: 0,
      },
      mock: true,
    })
    const image = await seedPost({
      kind: 'image',
      intent: 'share',
      status: 'scheduled',
      day: addDays(today, 1),
      hour: secondSlot,
      concept: 'The one n8n setting I change on every new workflow',
      sponsorSegment: 'none',
      written: {
        parts: ['The one n8n setting I change on every new workflow: an error workflow. Set it in the workflow settings, once.'],
        cardTitle: SEEDED_CARD_TITLE,
      },
    })
    // The image post sits at "scheduled", so its package was approved and its publication is queued.
    await createPostPublication(ctx, image, ada, { mock: true, status: 'queued' })

    // Ada took over an X account that already had a history: 40 hand-written posts (ADA_X_ORIGINALS and the
    // replies), and the voice the analyst learned from them, with her five most engaging originals as the
    // writer's examples.
    const adaHistory = adaXHistory(now)
    await insertAccountPosts(ctx, { personaId: adaId, source: 'mock', posts: adaHistory })
    for (const example of await topOriginalsOf(ctx, adaId, 5)) await ctx.db.patch(example._id, { example: true })
    await ctx.db.patch(adaId, { voice: { ...ADA_VOICE_TEXT, ...voiceStats(adaHistory), learnedAt: now - 3 * 86_400_000 } })

    // Max: two ideas on the next two days. Tomorrow's is written at once, so the writer has work on first
    // run whatever today is; the other waits for its script day.
    const max = await ctx.db.get(maxId)
    if (!max) throw new Error('persona vanished')
    for (const [offset, concept] of [
      [1, 'Give Claude Code an MCP server for your own API'],
      [2, 'An agent that opens the pull request and waits for review'],
    ] as const) {
      const day = addDays(today, offset)
      await createIdea(ctx, max, {
        kind: 'video',
        personaId: maxId,
        plannedFor: day,
        concept,
        pillar: 'MCP servers',
        sponsorSegment: 'none',
        signalIds: offset === 1 ? [seededSignal(4)] : [],
      })
    }
    await ctx.db.insert('checklistItems', {
      personaId: maxId,
      title: 'Connect a TikTok account for Max',
      why: "Publishing to TikTok needs an approved Content Posting app and Max's account. Until then the publisher runs in mock mode and says so on every publication.",
      status: 'open',
      action: { kind: 'set_provider_key', key: 'TIKTOK_OAUTH' },
      createdAt: now - 86_400_000,
    })
    return { workspaceId }
  },
})

/** Where a seeded publication lives on its platform. */
function mockPublicationUrl(platform: Platform, externalId: string): string {
  switch (platform) {
    case 'youtube':
      return `https://youtube.com/watch?v=${externalId}`
    case 'x':
      return `https://x.com/ada.automates/status/${externalId}`
    case 'tiktok':
    case 'instagram':
      return `https://${platform}.com/@ada.automates/video/${externalId}`
  }
}

/**
 * Every table in the schema, so `reset` cannot forget one: adding a table
 * to schema.ts without adding it here is a type error.
 */
const TABLES = {
  workspaces: true,
  personas: true,
  episodes: true,
  publications: true,
  accountPosts: true,
  accountCounts: true,
  metricSnapshots: true,
  links: true,
  linkClicks: true,
  conversions: true,
  discountCodes: true,
  signals: true,
  experiments: true,
  journal: true,
  memories: true,
  assets: true,
  directives: true,
  messages: true,
  checklistItems: true,
  jobs: true,
  runners: true,
} satisfies Record<TableNames, true>

/**
 * Wipes the deployment so `run` seeds from nothing: every document in every
 * table, plus the pending scheduled functions (they would wake up to jobs
 * that no longer exist) and the stored files the seed and the runner wrote.
 * One transaction, which fits a seed-sized deployment; a deployment with more
 * than a few thousand rows needs this in batches.
 */
export const reset = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    let deleted = 0
    for (const scheduled of await ctx.db.system.query('_scheduled_functions').collect()) {
      if (scheduled.state.kind === 'pending') await ctx.scheduler.cancel(scheduled._id)
    }
    for (const table of Object.keys(TABLES) as TableNames[]) {
      for (const row of await ctx.db.query(table).collect()) {
        await ctx.db.delete(row._id)
        deleted += 1
      }
    }
    for (const file of await ctx.db.system.query('_storage').collect()) await ctx.storage.delete(file._id)
    return { deleted }
  },
})
