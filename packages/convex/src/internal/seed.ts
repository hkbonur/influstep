import { v } from 'convex/values'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { internalAction, internalMutation } from '../_generated/server'
import { addDays, dayKey, instantAt, weekStart } from '../core/dates'
import { createIdea, createTrackedLink } from '../core/episodes'
import { buildDescription } from '../core/attribution'
import { enqueueJob } from '../jobs/queue'

/**
 * The demo workspace: two personas, a planned week, a running experiment,
 * signals, one episode at every status, and a month of history so the report
 * shows a funnel on first open. `pnpm seed` runs this; it is idempotent by
 * workspace name.
 */

const TIMEZONE = 'Europe/Oslo'

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
      platforms: ['youtube', 'tiktok', 'instagram'],
      voiceId: 'mock-ada',
      sponsorDial: 0.4,
      sponsorRampEpisodes: 10,
      episodesPerWeek: 5,
      autoApprove: false,
      paused: false,
      timezone: TIMEZONE,
      publishHour: 16,
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
      platforms: ['youtube', 'tiktok'],
      voiceId: 'mock-max',
      sponsorDial: 0.3,
      sponsorRampEpisodes: 10,
      episodesPerWeek: 3,
      autoApprove: true,
      paused: false,
      timezone: TIMEZONE,
      publishHour: 17,
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

    // History: Ada's last four weeks, published and measured, so the report has a funnel.
    const ada = await ctx.db.get(adaId)
    const workspace = await ctx.db.get(workspaceId)
    if (!ada || !workspace) throw new Error('seed rows vanished')
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
    for (const [index, [concept, pillar, sponsorSegment, variantKey]] of historyConcepts.entries()) {
      const plannedFor = addDays(today, -(26 - index * 3))
      const scheduledAt = instantAt(plannedFor, ada.publishHour, TIMEZONE)
      const hook =
        variantKey === 'wrong' ? `I was wrong about ${concept.toLowerCase()}.` : `How to ${concept.toLowerCase()} in under a minute.`
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
          body: `Here is the setup. ${concept}. Step one, open n8n and find the node that fails. Step two, add an error workflow and a retry.`,
          sponsor: sponsorSegment === 'none' ? '' : 'And when the workflow needs something from a customer, I use Formstep.',
          cta: 'Follow Ada for the next one.',
        },
        sponsorSegment,
        shots: [
          {
            kind: 'screen',
            id: 'shot-1',
            title: 'The fix',
            voiceover: hook,
            recipe: [
              { step: 'goto', url: 'http://localhost:5678' },
              { step: 'wait', ms: 2000 },
            ],
          },
        ],
        renders: [
          { aspect: '16:9', storageId: args.storageId, durationSec: 58, mock: true },
          { aspect: '9:16', storageId: args.storageId, durationSec: 58, mock: true },
        ],
        plannedFor,
        scheduledAt,
        experimentId,
        variantKey,
        signalIds: [],
        pillar,
        approvedAt: scheduledAt - 86_400_000,
        publishedAt: scheduledAt,
        measuredAt: index === historyConcepts.length - 1 ? undefined : scheduledAt + 72 * 3_600_000,
        createdAt: scheduledAt - 2 * 86_400_000,
        updatedAt: scheduledAt,
      })
      const episode = await ctx.db.get(episodeId)
      if (!episode) throw new Error('episode vanished')
      for (const platform of ada.platforms) {
        const linkId = await createTrackedLink(ctx, { persona: ada, episode, platform, target: workspace.sponsorUrl })
        const link = await ctx.db.get(linkId)
        if (!link) throw new Error('link vanished')
        const externalId = `mock-${platform}-${index}`
        const publicationId = await ctx.db.insert('publications', {
          episodeId,
          personaId: adaId,
          platform,
          status: 'live',
          title: concept,
          description: buildDescription({
            concept,
            sponsorSegment,
            sponsorName: workspace.sponsorName,
            trackedUrl: `${workspace.appUrl}/go/${link.slug}`,
            platform,
          }),
          linkId,
          scheduledAt,
          externalId,
          url:
            platform === 'youtube'
              ? `https://youtube.com/watch?v=${externalId}`
              : `https://${platform}.com/@ada.automates/video/${externalId}`,
          publishedAt: scheduledAt,
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
            at: scheduledAt + ((c + 1) * 60 * 3_600_000) / (clicks + 1),
          })
        }
        await ctx.db.patch(linkId, { clicks })
        for (const [snapshotIndex, hours] of [24, 72, Math.max(96, (now - scheduledAt) / 3_600_000)].entries()) {
          const views = Math.round(baseViews * Math.log2(2 + hours) * 0.4)
          await ctx.db.insert('metricSnapshots', {
            personaId: adaId,
            episodeId,
            publicationId,
            platform,
            takenAt: Math.min(now, scheduledAt + hours * 3_600_000) - snapshotIndex,
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
      // Conversions proportional to clicks, tied to the episode by its slug (ADR 0003).
      const links = await ctx.db
        .query('links')
        .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
        .collect()
      const totalClicks = links.reduce((sum, link) => sum + link.clicks, 0)
      const signups = Math.floor(totalClicks / 25)
      for (let s = 0; s < signups; s += 1) {
        const distinctId = `seed-${episode.slug}-${s}`
        const at = scheduledAt + (s + 1) * 7 * 3_600_000
        await ctx.db.insert('conversions', { personaId: adaId, episodeId, variantKey, kind: 'signup', distinctId, at, mock: true })
        if (s % 6 === 5)
          await ctx.db.insert('conversions', {
            personaId: adaId,
            episodeId,
            variantKey,
            kind: 'paid',
            distinctId,
            at: at + 86_400_000,
            mock: true,
          })
      }
    }

    // This week: one episode at each of the remaining statuses, so the calendar shows the whole pipeline.
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
      const scheduledAt = instantAt(item.day, ada.publishHour, TIMEZONE)
      const episodeId = await ctx.db.insert('episodes', {
        personaId: adaId,
        slug: `${item.concept
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .slice(0, 60)}-w${index}`,
        status: item.status,
        concept: item.concept,
        title: item.concept,
        hook: mkScript(item.concept).hook,
        script: mkScript(item.concept),
        sponsorSegment: index === 4 ? 'mention' : 'none',
        shots: [
          {
            kind: 'screen',
            id: 'shot-1',
            title: 'The problem',
            voiceover: mkScript(item.concept).hook,
            recipe: [
              { step: 'goto', url: 'https://news.ycombinator.com' },
              { step: 'wait', ms: 2000 },
            ],
          },
          {
            kind: 'screen',
            id: 'shot-2',
            title: 'The fix',
            voiceover: mkScript(item.concept).body,
            recipe: [
              { step: 'goto', url: 'http://localhost:5678' },
              { step: 'wait', ms: 2000 },
            ],
          },
        ],
        renders:
          item.status === 'scheduled'
            ? [
                { aspect: '16:9', storageId: args.storageId, durationSec: 55, mock: true },
                { aspect: '9:16', storageId: args.storageId, durationSec: 55, mock: true },
              ]
            : [],
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
        for (const platform of ada.platforms) {
          const linkId = await createTrackedLink(ctx, { persona: ada, episode, platform, target: workspace.sponsorUrl })
          const link = await ctx.db.get(linkId)
          if (!link) throw new Error('link vanished')
          await ctx.db.insert('publications', {
            episodeId,
            personaId: adaId,
            platform,
            status: 'queued',
            title: item.concept,
            description: buildDescription({
              concept: item.concept,
              sponsorSegment: 'mention',
              sponsorName: workspace.sponsorName,
              trackedUrl: `${workspace.appUrl}/go/${link.slug}`,
              platform,
            }),
            linkId,
            scheduledAt,
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
          payload: { episodeId, personaHandle: ada.handle, voiceId: ada.voiceId, shots: episode.shots, aspects: ['16:9', '9:16'] },
        })
      }
    }
    if (signalIds[0]) await ctx.db.patch(signalIds[0], { status: 'used' })

    // Max: two ideas for this week so the writer has work on first run.
    const max = await ctx.db.get(maxId)
    if (!max) throw new Error('persona vanished')
    for (const [offset, concept] of [
      [2, 'Give Claude Code an MCP server for your own API'],
      [4, 'An agent that opens the pull request and waits for review'],
    ] as const) {
      const day = addDays(monday, offset)
      if (day < today) continue
      await createIdea(ctx, max, {
        personaId: maxId,
        plannedFor: day,
        concept,
        pillar: 'MCP servers',
        sponsorSegment: 'none',
        signalIds: offset === 2 ? [signalIds[4] as Id<'signals'>] : [],
      })
    }
    await ctx.db.insert('checklistItems', {
      personaId: maxId,
      title: 'Connect a YouTube channel for Max',
      why: 'Publishing to YouTube needs an OAuth app and a channel. Until then the publisher runs in mock mode and says so on every publication.',
      status: 'open',
      action: { kind: 'set_provider_key', key: 'YOUTUBE_OAUTH' },
      createdAt: now - 86_400_000,
    })
    return { workspaceId }
  },
})
