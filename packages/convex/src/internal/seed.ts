import { v } from 'convex/values'
import { DEFAULT_FORMATS, formatAspects, resolveEpisodeFormat, type PlatformFormat } from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Id, TableNames } from '../_generated/dataModel'
import { internalAction, internalMutation } from '../_generated/server'
import { describePublication } from '../core/attribution'
import { addDays, dayKey, instantAt, weekStart } from '../core/dates'
import { createIdea, createTrackedLink, shotsFromDraft } from '../core/episodes'
import { earliestPublishAt, formatsFor, platformsOf } from '../core/formats'
import { enqueueJob } from '../jobs/queue'
import type { FoundConversion } from '../providers/analytics'
import { mockAnalytics } from '../providers/analytics/mock'
import { mockDiscounts } from '../providers/discounts/mock'
import { PRESENTER_TOOL, type ScriptDraft } from '../providers/llm'

/**
 * The demo workspace: two personas, a planned week, a running experiment,
 * signals, one episode at every status, and a month of history so the report
 * shows a funnel on first open. `pnpm seed` runs this; it is idempotent by
 * workspace name.
 */

const TIMEZONE = 'Europe/Oslo'

/** Ada posts everywhere, on the defaults, with a shorter YouTube tutorial and a slightly longer TikTok. */
const ADA_FORMATS: PlatformFormat[] = [
  { platform: 'youtube', ...DEFAULT_FORMATS.youtube, lengthSec: 240 },
  { platform: 'tiktok', ...DEFAULT_FORMATS.tiktok, lengthSec: 40 },
  { platform: 'instagram', ...DEFAULT_FORMATS.instagram },
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

export const run = internalAction({
  args: { appUrl: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ workspaceId: Id<'workspaces'> }> => {
    // A tiny placeholder file stands in for the seeded renders; the runner
    // uploads real (mock) videos for anything it produces from here on.
    const storageId = await ctx.storage.store(new Blob([new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70])], { type: 'video/mp4' }))
    return ctx.runMutation(internal.internal.seed.write, { storageId, appUrl: args.appUrl ?? 'http://localhost:3300' })
  },
})

export const write = internalMutation({
  args: { storageId: v.id('_storage'), appUrl: v.string() },
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
          url:
            platform === 'youtube'
              ? `https://youtube.com/watch?v=${externalId}`
              : `https://${platform}.com/@ada.automates/video/${externalId}`,
          publishedAt: liveAt,
          mock: true,
        })
        // Clicks and three snapshots per publication: the day after, three days after, and now.
        const platformFactor = platform === 'tiktok' ? 2.4 : platform === 'instagram' ? 1.3 : 1
        const baseViews = Math.round((900 + ((index * 131) % 700)) * platformFactor)
        const clickRate = variantKey === 'wrong' ? 0.021 : 0.014
        const clicks = Math.round(baseViews * clickRate)
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
          payload: { episodeId, personaHandle: ada.handle, voiceId: ada.voiceId, shots: episode.shots, aspects: adaAspects },
        })
      }
    }
    if (signalIds[0]) await ctx.db.patch(signalIds[0], { status: 'used' })

    // Max: two ideas on the next two days so the writer has work on first run, whatever today is.
    const max = await ctx.db.get(maxId)
    if (!max) throw new Error('persona vanished')
    for (const [offset, concept] of [
      [1, 'Give Claude Code an MCP server for your own API'],
      [2, 'An agent that opens the pull request and waits for review'],
    ] as const) {
      const day = addDays(today, offset)
      await createIdea(ctx, max, {
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
