import { v } from 'convex/values'
import {
  DEFAULT_FORMATS,
  X_IMAGE_ASPECT,
  formatAspects,
  postHook,
  postSlotHours,
  resolveEpisodeFormat,
  type EpisodePost,
  type Platform,
  type PlatformFormat,
  type PostKind,
} from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Id, TableNames } from '../_generated/dataModel'
import { internalAction, internalMutation } from '../_generated/server'
import { describePublication } from '../core/attribution'
import { openXChecklist } from '../core/checklist'
import { addDays, dayKey, instantAt, weekStart } from '../core/dates'
import { createIdea, createPostPublication, createTrackedLink, shotsFromDraft } from '../core/episodes'
import { earliestPublishAt, formatFor, formatsFor, platformsOf } from '../core/formats'
import { enqueueJob } from '../jobs/queue'
import type { FoundConversion } from '../providers/analytics'
import { mockAnalytics } from '../providers/analytics/mock'
import { mockDiscounts } from '../providers/discounts/mock'
import { PRESENTER_TOOL, type ScriptDraft } from '../providers/llm'

/**
 * The demo workspace: two personas, a planned week, a running experiment,
 * signals, one episode at every status, a post of every kind on X, and a
 * month of history so the report shows a funnel on first open. `pnpm seed` runs this; it is idempotent by
 * workspace name.
 */

const TIMEZONE = 'Europe/Oslo'

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

/** The card title of the seeded image post; the seeded card image shows the same words. */
const SEEDED_CARD_TITLE = 'Set an error workflow first'

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

export const run = internalAction({
  args: { appUrl: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ workspaceId: Id<'workspaces'> }> => {
    // A tiny placeholder file stands in for the seeded video renders; the runner
    // uploads real (mock) videos for anything it produces from here on.
    const storageId = await ctx.storage.store(new Blob([new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70])], { type: 'video/mp4' }))
    const cardStorageId = await ctx.storage.store(new Blob([seededCardSvg()], { type: 'image/svg+xml' }))
    return ctx.runMutation(internal.internal.seed.write, { storageId, cardStorageId, appUrl: args.appUrl ?? 'http://localhost:3300' })
  },
})

export const write = internalMutation({
  args: { storageId: v.id('_storage'), cardStorageId: v.id('_storage'), appUrl: v.string() },
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

    const experimentId = await ctx.db.insert('experiments', {
      personaId: adaId,
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
      status: 'running',
      minExposures: 2000,
      minConfidence: 0.9,
      createdAt: now - 20 * 86_400_000,
    })

    // Signals the researcher would have found.
    const seedSignals: {
      personaId: Id<'personas'>
      source: 'hackernews' | 'reddit' | 'google_trends' | 'comments'
      title: string
      summary: string
      url: string
      score: number
      topics: string[]
    }[] = [
      {
        personaId: adaId,
        source: 'reddit',
        title: 'n8n webhook fails silently when the client sends a form, how do I debug?',
        summary: 'r/n8n thread, 140 comments, most answers are about error workflows.',
        url: 'https://www.reddit.com/r/n8n/comments/example1',
        score: 92,
        topics: ['n8n', 'webhooks', 'debugging'],
      },
      {
        personaId: adaId,
        source: 'hackernews',
        title: 'Ask HN: How do you get customer sign-off inside an automated pipeline?',
        summary: 'Thread about pausing workflows until a client approves a quote.',
        url: 'https://news.ycombinator.com/item?id=1',
        score: 81,
        topics: ['workflows', 'approvals', 'customers'],
      },
      {
        personaId: adaId,
        source: 'google_trends',
        title: 'n8n vs make',
        summary: 'Breakout query in the last 30 days.',
        url: 'https://trends.google.com/trends/explore?q=n8n%20vs%20make',
        score: 64,
        topics: ['n8n', 'make', 'comparison'],
      },
      {
        personaId: adaId,
        source: 'comments',
        title: 'Can you show how to retry a failed webhook step?',
        summary: 'Asked under last week’s episode, 12 likes.',
        url: 'https://youtube.com/watch?v=mock',
        score: 70,
        topics: ['n8n', 'webhooks'],
      },
      {
        personaId: maxId,
        source: 'hackernews',
        title: 'Claude Code and MCP: the agent that files its own tickets',
        summary: 'MCP servers that let an agent act on real tools, with a long comment thread on safety.',
        url: 'https://news.ycombinator.com/item?id=2',
        score: 95,
        topics: ['ai agents', 'mcp', 'claude'],
      },
      {
        personaId: maxId,
        source: 'google_trends',
        title: 'ai agents tutorial',
        summary: 'Rising query, +140% over 90 days.',
        url: 'https://trends.google.com/trends/explore?q=ai%20agents%20tutorial',
        score: 77,
        topics: ['ai agents', 'tutorial'],
      },
    ]
    const signalIds: Id<'signals'>[] = []
    for (const [index, signal] of seedSignals.entries()) {
      signalIds.push(
        await ctx.db.insert('signals', {
          ...signal,
          externalId: `seed-${index}`,
          status: 'new',
          foundAt: now - index * 5 * 3_600_000,
          mock: true,
        })
      )
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
    const platformInstant = (day: string, format: PlatformFormat) => instantAt(day, format.publishHour, TIMEZONE)
    const adaRenders = (durationSec: number) => adaAspects.map((aspect) => ({ aspect, storageId: args.storageId, durationSec, mock: true }))
    const today = dayKey(now, TIMEZONE)
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
      const scheduledAt = earliestPublishAt(ada, adaPlatforms, plannedFor)
      // Live once the last platform went out.
      const publishedAt = Math.max(...adaFormats.map((format) => platformInstant(plannedFor, format)))
      const hook =
        variantKey === 'wrong' ? `I was wrong about ${concept.toLowerCase()}.` : `How to ${concept.toLowerCase()} in under a minute.`
      const body = `Here is the setup. ${concept}. Step one, open n8n and find the node that fails. Step two, add an error workflow and a retry.`
      const draft: Pick<ScriptDraft, 'hook' | 'shotPlan'> = {
        hook,
        shotPlan: [
          { title: 'The hook', voiceover: hook, tool: PRESENTER_TOOL, url: '' },
          { title: 'The fix', voiceover: body, tool: 'n8n', url: 'http://localhost:5678' },
        ],
      }
      const episodeId = await ctx.db.insert('episodes', {
        personaId: adaId,
        slug: `${concept
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60)}-s${index}`,
        kind: 'video',
        status: index === historyConcepts.length - 1 ? 'published' : 'measured',
        concept,
        title: concept,
        hook,
        script: {
          hook,
          body,
          sponsor: sponsorSegment === 'none' ? '' : 'And when the workflow needs something from a customer, I use Formstep.',
          cta: 'Follow Ada for the next one.',
        },
        sponsorSegment,
        platforms: adaPlatforms,
        format: adaFormat,
        shotPlan: draft.shotPlan,
        shots: shotsFromDraft(draft, workspace.sponsorName, adaFormat.delivery),
        renders: adaRenders(58),
        plannedFor,
        scheduledAt,
        experimentId,
        variantKey,
        signalIds: [],
        pillar,
        approvedAt: scheduledAt - 86_400_000,
        publishedAt,
        measuredAt: index === historyConcepts.length - 1 ? undefined : publishedAt + 72 * 3_600_000,
        createdAt: scheduledAt - 2 * 86_400_000,
        updatedAt: publishedAt,
      })
      const episode = await ctx.db.get(episodeId)
      if (!episode) throw new Error('episode vanished')
      for (const format of adaFormats) {
        const { platform } = format
        const liveAt = platformInstant(plannedFor, format)
        const linkId = await createTrackedLink(ctx, { persona: ada, episode, platform, target: workspace.sponsorUrl })
        const link = await ctx.db.get(linkId)
        if (!link) throw new Error('link vanished')
        const externalId = `mock-${platform}-${index}`
        const publicationId = await ctx.db.insert('publications', {
          episodeId,
          personaId: adaId,
          platform,
          aspect: format.aspect,
          status: 'live',
          title: concept,
          ...describePublication({ workspace, episode, platform, linkSlug: link.slug, discountCode: adaCode }),
          linkId,
          scheduledAt: liveAt,
          externalId,
          url: mockPublicationUrl(platform, externalId),
          publishedAt: liveAt,
          mock: true,
        })
        // Clicks and three snapshots per publication: the day after, three days after, and now.
        const platformFactor = platform === 'tiktok' ? 2.4 : platform === 'instagram' ? 1.3 : 1
        const baseViews = Math.round((900 + ((index * 131) % 700)) * platformFactor)
        const clickRate = variantKey === 'wrong' ? 0.021 : 0.014
        // Nothing is appended on X, so its tracked link is never printed and never clicked.
        const clicks = platform === 'x' ? 0 : Math.round(baseViews * clickRate)
        for (let c = 0; c < clicks; c += 1) {
          await ctx.db.insert('linkClicks', {
            linkId,
            personaId: adaId,
            episodeId,
            at: liveAt + ((c + 1) * 60 * 3_600_000) / (clicks + 1),
          })
        }
        await ctx.db.patch(linkId, { clicks })
        for (const [snapshotIndex, hours] of [24, 72, Math.max(96, (now - liveAt) / 3_600_000)].entries()) {
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
      const links = await ctx.db
        .query('links')
        .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
        .collect()
      history.push({ episodeId, variantKey, scheduledAt, clicks: links.reduce((sum, link) => sum + link.clicks, 0) })
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

    // This week: one episode at each of the remaining statuses, so the calendar shows the whole pipeline.
    // Every one is scripted or later, so it carries Ada's resolved format and the beats its shots came from.
    const monday = weekStart(today)
    const mkScript = (concept: string) => ({
      hook: `How to ${concept.toLowerCase()} in under a minute.`,
      body: `Here is the setup. ${concept}. Step one, open the tool. Step two, fix it the plain way.`,
      sponsor: '',
      cta: 'Follow Ada for the next one.',
    })
    const thisWeek = [
      {
        day: addDays(monday, 0),
        status: 'failed',
        concept: 'Debug a webhook that fails silently',
        error: 'produce: n8n at localhost:5678 did not answer within 30s',
      },
      { day: addDays(monday, 1), status: 'scripted', concept: 'Retry a failed webhook step without losing the payload' },
      { day: addDays(monday, 2), status: 'waiting_on_you', concept: 'Error workflows that page you only once' },
      { day: addDays(monday, 3), status: 'recording', concept: 'An agent that drafts the reply and waits for you' },
      { day: addDays(monday, 4), status: 'scheduled', concept: 'Pause a workflow until the customer signs off' },
    ] as const
    for (const [index, item] of thisWeek.entries()) {
      const script = mkScript(item.concept)
      const scheduledAt = earliestPublishAt(ada, adaPlatforms, item.day)
      const draft: Pick<ScriptDraft, 'hook' | 'shotPlan'> = {
        hook: script.hook,
        shotPlan: [
          { title: 'The problem', voiceover: script.hook, tool: 'browser', url: 'https://news.ycombinator.com' },
          { title: 'The fix', voiceover: script.body, tool: 'n8n', url: 'http://localhost:5678' },
        ],
      }
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
        hook: script.hook,
        script,
        sponsorSegment: index === 4 ? 'mention' : 'none',
        platforms: adaPlatforms,
        format: adaFormat,
        shotPlan: draft.shotPlan,
        shots: shotsFromDraft(draft, workspace.sponsorName, adaFormat.delivery),
        renders: item.status === 'scheduled' ? adaRenders(55) : [],
        plannedFor: item.day,
        scheduledAt,
        experimentId,
        variantKey: index % 2 === 0 ? 'howto' : 'wrong',
        signalIds: index === 1 ? [signalIds[0] as Id<'signals'>] : [],
        pillar: 'n8n tutorials',
        error: 'error' in item ? item.error : undefined,
        approvedAt: item.status === 'scripted' ? undefined : now - 3_600_000,
        createdAt: now - 2 * 86_400_000,
        updatedAt: now - 3_600_000,
      })
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
      if (item.status === 'scheduled') {
        const episode = await ctx.db.get(episodeId)
        if (!episode) throw new Error('episode vanished')
        for (const format of adaFormats) {
          const { platform } = format
          const linkId = await createTrackedLink(ctx, { persona: ada, episode, platform, target: workspace.sponsorUrl })
          const link = await ctx.db.get(linkId)
          if (!link) throw new Error('link vanished')
          await ctx.db.insert('publications', {
            episodeId,
            personaId: adaId,
            platform,
            aspect: format.aspect,
            status: 'queued',
            title: item.concept,
            ...describePublication({ workspace, episode, platform, linkSlug: link.slug, discountCode: adaCode }),
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
          payload: { kind: 'video', episodeId, personaHandle: ada.handle, voiceId: ada.voiceId, shots: episode.shots, aspects: adaAspects },
        })
      }
    }
    if (signalIds[0]) await ctx.db.patch(signalIds[0], { status: 'used' })

    // Ada on X: the label and connect items a persona gets when it gains X, and one post of each kind.
    // A text post waits for approval, a thread went live two days ago, and an image post's card is
    // rendered and queued. Each sits at one of the day's post slots.
    await openXChecklist(ctx, ada)
    const [firstSlot, secondSlot] = postSlotHours(formatFor(ada, 'x'))
    if (firstSlot === undefined || secondSlot === undefined) throw new Error("Ada's X cadence has fewer than two posts a day")
    const seedPost = async (post: {
      kind: PostKind
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
        status: post.status,
        concept: post.concept,
        title: post.concept,
        hook: postHook(post.written.parts),
        script: { hook: '', body: '', sponsor: '', cta: '' },
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
    const threadPublicationId = await createPostPublication(ctx, thread, ada, { mock: true })
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
    await createPostPublication(ctx, image, ada, { mock: true })

    // Max: two ideas on the next two days so the writer has work on first run, whatever today is.
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
        signalIds: offset === 1 ? [signalIds[4] as Id<'signals'>] : [],
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
  metricSnapshots: true,
  links: true,
  linkClicks: true,
  conversions: true,
  discountCodes: true,
  signals: true,
  experiments: true,
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
