import { ConvexError, v, type Infer } from 'convex/values'
import {
  EPISODE_STATUS_LABELS,
  MEASUREMENT_WINDOW_MS,
  POLLED_SIGNAL_SOURCES,
  POST_LENGTH_LABELS,
  PUBLICATION_BODY_MAX,
  PUBLICATION_TITLE_MAX,
  X_POST_LIMIT,
  chatIntentSchema,
  decideExperiment,
  effectiveStyle,
  hookOf,
  isChatTask,
  isCold,
  isPost,
  isScriptKind,
  lengthProblem,
  normalizeDiscountCode,
  pillarWeights,
  postLengthOf,
  postProblems,
  resolveEpisodeFormat,
  scriptProblems,
  signalFreshness,
  styleLines,
  variantLength,
  variantRate,
  voiceStatsOf,
  weekdayOf,
  type ChatIntent,
  type ChatTask,
  type EpisodePost,
  type PostKind,
  type PostLength,
  type SignalSource,
} from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from '../_generated/server'
import {
  accountCountsOf,
  examplePostsOf,
  insertAccountPosts,
  newestOriginalsOf,
  requireXPersona,
  topOriginalsOf,
  voiceSampleOf,
} from '../core/account'
import { applyChatIntent, changeablePlan } from '../core/chat'
import { addDays, dayKey } from '../core/dates'
import { discountCodesFor as discountCodesRule, redemptionOwner } from '../core/discounts'
import { approveEpisode, createIdea, formatAndShots } from '../core/episodes'
import {
  analystDecisionNote,
  applyExperimentDecision,
  episodeEffectiveVariant,
  episodeVariant,
  postKindPlan,
  variantStatsFor,
  videoPlanExperiment,
  type EpisodeVariant,
} from '../core/experiments'
import { placeAssets } from '../core/assets'
import { formatFor, formatsFor } from '../core/formats'
import { PILLAR_HISTORY_DAYS, planPostSlots, planWeek as planWeekRule } from '../core/planner'
import { savePost } from '../core/posts'
import { reportWindow } from '../core/report'
import { lastCheck, logRepeatedQuestions, writeDailyBrief } from '../core/research'
import { reviewStrategy as reviewStrategyRule, type ReviewOutcome } from '../core/strategy'
import { workspaceOf } from '../core/workspace'
import { providersMode } from '../lib/env'
import { analyticsProvider } from '../providers/analytics'
import { platformProvider } from '../providers/comments'
import { discountsProvider } from '../providers/discounts'
import {
  POST_LENGTH_TARGETS,
  llmProvider,
  type AccountPostSample,
  type ChatTurn,
  type PlanRow,
  type PostBrief,
  type ScriptBrief,
  type ScriptDraft,
  type TaskReportArgs,
  type TaskSignal,
} from '../providers/llm'
import { signalSourceHasRealAdapter, signalsProvider } from '../providers/signals'
import { timelineProvider } from '../providers/timeline'
import {
  conversionKindValidator,
  episodePostValidator,
  importedPostValidator,
  platformValidator,
  shotPlanValidator,
  signalSourceValidator,
  voiceValidator,
  type StoredBeat,
} from '../lib/validators'
import { applyEvent, type EpisodeContext } from './data'
import { measureReplies } from './replies'

/**
 * The five agent roles as actions. Each reads through internal queries, calls
 * a provider, and writes through internal mutations. A thrown error fails the
 * job (and the episode, when there is one) in dispatch.ts.
 */

// ---------------------------------------------------------------------------
// Researcher
// ---------------------------------------------------------------------------

export const pollSignals = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, args): Promise<PollResult> => {
    const { persona } = await ctx.runQuery(internal.internal.data.getPersona, { personaId: args.personaId as Id<'personas'> })
    return pollSources(ctx, persona)
  },
})

/** How many signals a poll stored new, and the sources it skipped because real mode has no adapter for them yet. */
type PollResult = { found: number; skipped: SignalSource[] }

/**
 * One poll of every source the researcher reads (shared
 * `POLLED_SIGNAL_SOURCES`), for the hourly poll and the morning sweep alike.
 * Comments and problems are not polled: the publisher and the problem log
 * write those.
 */
async function pollSources(ctx: ActionCtx, persona: Doc<'personas'>): Promise<PollResult> {
  const terms = [...persona.pillars, persona.niche]
  const since = Date.now() - 7 * 24 * 3_600_000
  const mock = providersMode() === 'mock'
  const skipped: SignalSource[] = []
  let found = 0
  for (const source of POLLED_SIGNAL_SOURCES) {
    if (!mock && !signalSourceHasRealAdapter(source)) {
      skipped.push(source)
      continue
    }
    const signals = await signalsProvider(source).find({ terms, since, limit: 5 })
    found += await ctx.runMutation(internal.internal.agents.storeSignals, { personaId: persona._id, signals, mock })
  }
  return { found, skipped }
}

/**
 * The morning sweep (docs/plan.md, v0.2 item 9): the researcher polls every
 * source, then logs the questions viewers keep asking and writes the day's
 * brief from what moved, in that order, so the brief lists today's new
 * problems. It runs after the morning's comment poll, so the comments it
 * groups are today's.
 */
export const morningSweep = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, args): Promise<PollResult & { briefId: Id<'memories'>; problems: number }> => {
    const personaId = args.personaId as Id<'personas'>
    const { persona } = await ctx.runQuery(internal.internal.data.getPersona, { personaId })
    const poll = await pollSources(ctx, persona)
    const sweep: { briefId: Id<'memories'>; problems: number } = await ctx.runMutation(internal.internal.agents.morningSweepMutation, {
      personaId,
    })
    return { ...poll, ...sweep }
  },
})

/** The sweep's writes in one transaction: the problem log first, then the brief that reads it. `problems` counts the new problems. */
export const morningSweepMutation = internalMutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<{ briefId: Id<'memories'>; problems: number }> => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    const now = Date.now()
    const problems = await logRepeatedQuestions(ctx, persona, now)
    const briefId = await writeDailyBrief(ctx, persona, now)
    return { briefId, problems: problems.length }
  },
})

/**
 * A re-found signal keeps its status and its first find; its score and
 * summary follow the source, and its post time too when the source gives
 * one, so a search suggestion people still type stays fresh.
 */
export const storeSignals = internalMutation({
  args: {
    personaId: v.id('personas'),
    mock: v.boolean(),
    signals: v.array(
      v.object({
        source: signalSourceValidator,
        externalId: v.string(),
        title: v.string(),
        url: v.string(),
        summary: v.string(),
        score: v.number(),
        topics: v.array(v.string()),
        publishedAt: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args): Promise<number> => {
    let inserted = 0
    for (const signal of args.signals) {
      const existing = await ctx.db
        .query('signals')
        .withIndex('by_persona_external', (q) =>
          q.eq('personaId', args.personaId).eq('source', signal.source).eq('externalId', signal.externalId)
        )
        .first()
      if (existing) {
        await ctx.db.patch(existing._id, {
          score: signal.score,
          summary: signal.summary,
          ...(signal.publishedAt === undefined ? {} : { publishedAt: signal.publishedAt }),
        })
        continue
      }
      await ctx.db.insert('signals', { ...signal, personaId: args.personaId, status: 'new', foundAt: Date.now(), mock: args.mock })
      inserted += 1
    }
    return inserted
  },
})

/**
 * Import from X (docs/plan.md, slice 5): the account's own timeline becomes
 * its history. Reading only; nothing is posted, liked or followed. Mock mode
 * serves plausible history from the persona's niche and pillars; real mode
 * refuses until the X adapter exists.
 */
export const importXHistory = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, args): Promise<{ added: number; skipped: number }> => {
    const personaId = args.personaId as Id<'personas'>
    const persona = await ctx.runQuery(internal.internal.agents.xPersona, { personaId })
    const posts = await timelineProvider().history({
      handle: persona.handle,
      niche: persona.niche,
      pillars: persona.pillars,
      now: Date.now(),
    })
    return ctx.runMutation(internal.internal.agents.storeAccountPosts, {
      personaId,
      source: providersMode() === 'mock' ? 'mock' : 'api',
      posts,
    })
  },
})

/** The persona, or the refusal core/account.ts gives when it has no X account to take over. */
export const xPersona = internalQuery({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<Doc<'personas'>> => requireXPersona(ctx, args.personaId),
})

/** The timeline's posts, through the same dedupe as the operator's import: a post already there is skipped. */
export const storeAccountPosts = internalMutation({
  args: {
    personaId: v.id('personas'),
    source: v.union(v.literal('api'), v.literal('mock')),
    posts: v.array(importedPostValidator),
  },
  handler: async (ctx, args): Promise<{ added: number; skipped: number }> => {
    await requireXPersona(ctx, args.personaId)
    return insertAccountPosts(ctx, args)
  },
})

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export const planWeek = internalAction({
  args: { personaId: v.string(), weekStart: v.string() },
  handler: async (ctx, args): Promise<{ planned: number }> => {
    return ctx.runMutation(internal.internal.agents.planWeekMutation, {
      personaId: args.personaId as Id<'personas'>,
      weekStart: args.weekStart,
    })
  },
})

export const planWeekMutation = internalMutation({
  args: { personaId: v.id('personas'), weekStart: v.string() },
  handler: async (ctx, args): Promise<{ planned: number }> => {
    const persona = await ctx.db.get(args.personaId)
    if (!persona) throw new Error(`persona ${args.personaId} not found`)
    if (persona.paused) return { planned: 0 }
    const all = await ctx.db
      .query('episodes')
      .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
      .collect()
    const live = all.filter((episode) => episode.status !== 'killed')
    const now = Date.now()
    // Days already holding a video, plus days already gone: the planner never schedules into the past.
    // Posts have slots of their own, so a day of posts still takes a video.
    const today = dayKey(now, persona.timezone)
    const takenDays = [
      ...live.filter((episode) => !isPost(episode.kind) && episode.plannedFor >= args.weekStart).map((episode) => episode.plannedFor),
      ...Array.from({ length: 7 }, (_, offset) => addDays(args.weekStart, offset)).filter((day) => day < today),
    ]
    // Both rankers read a signal's freshness as its score, so a story from last week loses to one from this
    // morning, and a cold one is left out: it is too old to react to by the time the episode goes out.
    const signals = (
      await ctx.db
        .query('signals')
        .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'new'))
        .collect()
    )
      .map((signal) => ({ id: signal._id, title: signal.title, score: signalFreshness(signal, now), topics: signal.topics }))
      .filter((signal) => !isCold(signal.score))
    const running = await ctx.db
      .query('experiments')
      .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id).eq('status', 'running'))
      .first()
    // "Planned in the last PILLAR_HISTORY_DAYS days" is read by the day an episode is planned for, from that
    // many days before today on, as the post slots read it (core planPostSlots), so the videos already planned
    // for this week and the next count too: the allocation then tops up the pillars the recent weeks gave less
    // than their weight. A pillar the persona no longer has carries no weight and is left out.
    const since = addDays(today, -PILLAR_HISTORY_DAYS)
    const recentVideos = live.filter((episode) => !isPost(episode.kind) && episode.plannedFor >= since)
    const priorCounts = Object.fromEntries(
      persona.pillars.map((pillar) => [pillar, recentVideos.filter((episode) => episode.pillar === pillar).length])
    )
    const plan = planWeekRule({
      weekStart: args.weekStart,
      persona: {
        pillars: persona.pillars,
        sponsorDial: persona.sponsorDial,
        sponsorRampEpisodes: persona.sponsorRampEpisodes,
        episodesPerWeek: persona.episodesPerWeek,
        episodeCount: live.length,
      },
      pillarWeights: pillarWeights(persona.pillars, persona.strategy?.pillarWeights),
      priorCounts,
      signals,
      experiment: videoPlanExperiment(running, live),
      takenDays,
    })
    for (const planned of plan) {
      await createIdea(ctx, persona, {
        personaId: persona._id,
        plannedFor: planned.plannedFor,
        concept: planned.concept,
        pillar: planned.pillar,
        sponsorSegment: planned.sponsorSegment,
        signalIds: planned.signalId ? [planned.signalId as Id<'signals'>] : [],
        experimentId: planned.experimentId ? (planned.experimentId as Id<'experiments'>) : undefined,
        variantKey: planned.variantKey,
        kind: 'video',
      })
    }
    const xFormat = persona.formats.find((format) => format.platform === 'x')
    if (!xFormat) return { planned: plan.length }
    if (!xFormat.cadence) throw new Error('an X format without a post cadence cannot plan posts')
    const usedSignals = new Set(plan.map((planned) => planned.signalId))
    const livePosts = live.filter((episode) => isPost(episode.kind))
    const posts = planPostSlots({
      weekStart: args.weekStart,
      persona,
      format: xFormat,
      posts: livePosts,
      episodeCount: live.length + plan.length,
      signals: signals.filter((signal) => !usedSignals.has(signal.id)),
      postKinds: postKindPlan(persona, running, livePosts),
      now,
    })
    for (const post of posts) {
      await createIdea(ctx, persona, {
        personaId: persona._id,
        plannedFor: post.plannedFor,
        concept: post.concept,
        pillar: post.pillar,
        sponsorSegment: post.sponsorSegment,
        signalIds: post.signalId ? [post.signalId as Id<'signals'>] : [],
        experimentId: post.experimentId ? (post.experimentId as Id<'experiments'>) : undefined,
        variantKey: post.variantKey,
        kind: post.kind,
        publishHour: post.hour,
        intent: post.intent,
        length: post.length,
      })
    }
    return { planned: plan.length + posts.length }
  },
})

/**
 * The writer, for a video and a post alike. It writes the day before the
 * publish day, so it first takes a last look at what moved (core
 * `lastCheck`): a reactive concept whose signal went cold is swapped for the
 * strongest fresh one before the context is read, and the writer writes the
 * new concept. The writer then reads this morning's brief and the problem log
 * with the rest of the context.
 *
 * The video path: one script for every platform the episode goes to. The
 * writer gets the resolved delivery, the length scaled by the episode-length
 * variant in force, and the hook convention of each platform, in PLATFORMS
 * order. It also gets the persona's memory and the style in force on every
 * dimension (shared `effectiveStyle`), so a decided experiment changes the
 * next script. The beats are the script, held to the shared rules
 * (`scriptProblems`, `lengthProblem`) and the description to what a
 * publication can carry; a draft that misses goes back to the model once with
 * the problems named, and a second miss fails the episode with them.
 */
export const writeScript = internalAction({
  args: { episodeId: v.string() },
  handler: async (ctx, args): Promise<WriterResult> => {
    const episodeId = args.episodeId as Id<'episodes'>
    await ctx.runMutation(internal.internal.agents.lastCheckMutation, { episodeId })
    const context: EpisodeContext = await ctx.runQuery(internal.internal.data.getEpisodeContext, { episodeId })
    const kind = context.episode.kind
    if (isPost(kind)) return writePost(ctx, context, kind)
    const { episode, persona, workspace, directives, signals, experiment, memory, assets, research } = context
    const variant = episodeVariant(episode, experiment)
    const style = effectiveStyle({ variant, sponsorSegment: episode.sponsorSegment }, persona.strategy?.defaults)
    const formats = formatsFor(persona, episode.platforms)
    const format = resolveEpisodeFormat(formats)
    const brief: ScriptBrief = {
      persona: {
        name: persona.name,
        handle: persona.handle,
        niche: persona.niche,
        tone: persona.tone,
        bible: persona.bible,
        pillars: persona.pillars,
      },
      concept: episode.concept,
      pillar: episode.pillar ?? persona.pillars[0] ?? '',
      sponsorSegment: episode.sponsorSegment,
      sponsorName: workspace.sponsorName,
      sponsorUrl: workspace.sponsorUrl,
      variant: scriptVariantOf(variant),
      memory,
      assets,
      style,
      styleLines: styleLines(style, variant?.kind),
      directives: directives.map((directive) => directive.text),
      signals: signals.map((signal) => ({ title: signal.title, summary: signal.summary, url: signal.url })),
      research,
      format: {
        lengthSec: variantLength(format.lengthSec, style.length),
        delivery: format.delivery,
        hookNotes: formats.map((candidate) => candidate.hookNote),
      },
      problems: [],
    }
    const llm = llmProvider()
    const first = checkedScript(brief, await llm.writeScript(brief))
    const final = first.problems.length === 0 ? first : checkedScript(brief, await llm.writeScript({ ...brief, problems: first.problems }))
    if (final.problems.length > 0) throw new Error(`The writer missed the script's rules twice: ${final.problems.join(' ')}`)
    return ctx.runMutation(internal.internal.agents.storeScript, {
      episodeId,
      title: final.draft.title,
      description: final.draft.description,
      shotPlan: final.beats,
      autoApprove: persona.autoApprove,
    })
  },
})

/** The last check's swap, or none, in one transaction; it runs before the writer reads the episode. */
export const lastCheckMutation = internalMutation({
  args: { episodeId: v.id('episodes') },
  handler: async (ctx, args): ReturnType<typeof lastCheck> => lastCheck(ctx, args.episodeId, Date.now()),
})

/**
 * The variant line of the writer's brief, for a dimension the writer
 * scripts. A publish time or description format variant is applied after the
 * script (the publish hour, the description footer), so the writer gets no
 * variant line for it.
 */
function scriptVariantOf(variant: EpisodeVariant | undefined): ScriptBrief['variant'] {
  if (!variant || !isScriptKind(variant.kind)) return undefined
  return { kind: variant.kind, key: variant.key, description: variant.description }
}

/**
 * What the writer's job ends with: the title it wrote, or a skip when the
 * episode was killed while the model was writing. Killing an episode fails
 * its queued jobs but cannot stop one that is running, so the store step is
 * where a late draft is dropped, and the job still ends done.
 */
type WriterResult = { title: string } | { skipped: 'killed' }

/**
 * The draft with each asset it asked for placed (core `placeAssets`), and
 * everything wrong with it: an asset the library does not hold, then the
 * script's own rules.
 */
function checkedScript(brief: ScriptBrief, draft: ScriptDraft): { draft: ScriptDraft; beats: StoredBeat[]; problems: string[] } {
  const placed = placeAssets(draft.shotPlan, brief.assets, brief.sponsorName)
  return { draft, beats: placed.beats, problems: [...placed.problems, ...scriptDraftProblems(brief, draft)] }
}

/**
 * The shared beat rules for the sponsor segment, the format's length, then
 * what a publication takes: a title every platform accepts (YouTube's limit
 * is the strictest, and any title inside it fits X too) and a description the
 * operator can save as it is, without the link the footer adds when it goes
 * out.
 */
function scriptDraftProblems(brief: ScriptBrief, draft: ScriptDraft): string[] {
  const problems = scriptProblems(draft.shotPlan, { sponsorSegment: brief.sponsorSegment, sponsorName: brief.sponsorName })
  const length = lengthProblem(draft.shotPlan, brief.format.lengthSec)
  return [...problems, ...(length === null ? [] : [length]), ...titleProblems(draft.title), ...descriptionProblems(draft.description)]
}

function titleProblems(title: string): string[] {
  if (title.trim().length === 0) return ['The title is empty.']
  const length = Array.from(title).length
  if (length > PUBLICATION_TITLE_MAX) return [`The title is ${length} characters; keep it within ${PUBLICATION_TITLE_MAX}.`]
  return []
}

const LINK = /https?:\/\/|www\./i

function descriptionProblems(description: string): string[] {
  if (description.trim().length === 0) return ['The description is empty; write one to three sentences about what the video shows.']
  const problems: string[] = []
  const length = Array.from(description).length
  if (length > PUBLICATION_BODY_MAX) problems.push(`The description is ${length} characters; it holds ${PUBLICATION_BODY_MAX}.`)
  if (LINK.test(description)) problems.push('The description carries a link; the tracked link is added when it goes out.')
  return problems
}

/**
 * The draft becomes the episode's title, description, beats, format and
 * shots, and its hook is the first sentence of the first beat (shared
 * `hookOf`), the line the recording opens with. The format is fixed here,
 * from the persona's formats and the episode-length variant in force at this
 * moment, so a later settings change does not alter a written script. The
 * length variant is resolved again by the rule the writer's brief used
 * (shared `effectiveVariant`), so the stored length and the brief's agree.
 */
export const storeScript = internalMutation({
  args: {
    episodeId: v.id('episodes'),
    title: v.string(),
    description: v.string(),
    shotPlan: shotPlanValidator,
    autoApprove: v.boolean(),
  },
  handler: async (ctx, args): Promise<WriterResult> => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) throw new Error(`episode ${args.episodeId} not found`)
    if (episode.status === 'killed') return { skipped: 'killed' }
    const persona = await ctx.db.get(episode.personaId)
    if (!persona) throw new Error(`persona ${episode.personaId} not found`)
    const workspace = await workspaceOf(ctx, persona)
    const { format, shots } = formatAndShots({
      persona,
      platforms: episode.platforms,
      draft: { shotPlan: args.shotPlan },
      sponsorName: workspace.sponsorName,
      length: await episodeEffectiveVariant(ctx, 'length', episode, persona),
    })
    await ctx.db.patch(args.episodeId, {
      title: args.title,
      description: args.description,
      hook: hookOf(args.shotPlan),
      shotPlan: args.shotPlan,
      format,
      shots,
      updatedAt: Date.now(),
    })
    await applyEvent(ctx, args.episodeId, { type: 'script_written' })
    if (args.autoApprove) await approveEpisode(ctx, args.episodeId)
    return { title: args.title }
  },
})

/**
 * The writer's post path. The limits are X's: every part up to X_POST_LIMIT,
 * and X gets the parts exactly as written. The post is written to the
 * intent and length the planner chose, in the account's voice with its
 * example posts in front of the writer. A draft that breaks a limit or
 * misses the length goes back to the model once with the problems named; a
 * second miss fails the episode with them.
 */
async function writePost(ctx: ActionCtx, context: EpisodeContext, kind: PostKind): Promise<WriterResult> {
  const { episode, persona, workspace, directives, signals, examples, memory, research } = context
  // A post planned before intents and lengths existed has neither and is written to its kind alone.
  const length = episode.length ?? null
  const brief: PostBrief = {
    persona: {
      name: persona.name,
      handle: persona.handle,
      niche: persona.niche,
      tone: persona.tone,
      bible: persona.bible,
      pillars: persona.pillars,
    },
    kind,
    concept: episode.concept,
    pillar: episode.pillar ?? persona.pillars[0] ?? '',
    sponsorSegment: episode.sponsorSegment,
    sponsorName: workspace.sponsorName,
    memory,
    directives: directives.map((directive) => directive.text),
    signals: signals.map((signal) => ({ title: signal.title, summary: signal.summary, url: signal.url })),
    research,
    hookNote: formatFor(persona, 'x').hookNote,
    partLimit: X_POST_LIMIT,
    intent: episode.intent ?? null,
    length,
    voice: persona.voice
      ? {
          language: persona.voice.language,
          summary: persona.voice.summary,
          traits: persona.voice.traits,
          emoji: persona.voice.emoji,
          hashtags: persona.voice.hashtags,
        }
      : null,
    examples: examples.map((example) => example.parts),
    problems: [],
  }
  const llm = llmProvider()
  const first = await llm.writePost(brief)
  const firstProblems = draftProblems(kind, length, first.post)
  const draft = firstProblems.length === 0 ? first : await llm.writePost({ ...brief, problems: firstProblems })
  const problems = draftProblems(kind, length, draft.post)
  if (problems.length > 0) throw new Error(`The writer missed the post's limits twice: ${problems.join(' ')}`)
  return ctx.runMutation(internal.internal.agents.storePost, {
    episodeId: episode._id,
    title: draft.title,
    post: draft.post,
    autoApprove: persona.autoApprove,
  })
}

/** X's rules for the kind (shared `postProblems`), then the length the planner chose, when it chose one. */
function draftProblems(kind: PostKind, length: PostLength | null, post: EpisodePost): string[] {
  const problems = postProblems(kind, post)
  if (length === null) return problems
  const written = postLengthOf(post.parts)
  if (written === length) return problems
  return [...problems, `This post should be ${POST_LENGTH_TARGETS[length]}; the draft is a ${POST_LENGTH_LABELS[written].toLowerCase()}.`]
}

/**
 * The written post becomes the episode's post, through the same save as the
 * operator's editor, so its first line is the hook the experiments compare.
 */
export const storePost = internalMutation({
  args: {
    episodeId: v.id('episodes'),
    title: v.string(),
    post: episodePostValidator,
    autoApprove: v.boolean(),
  },
  handler: async (ctx, args): Promise<WriterResult> => {
    const episode = await ctx.db.get(args.episodeId)
    if (!episode) throw new Error(`episode ${args.episodeId} not found`)
    if (episode.status === 'killed') return { skipped: 'killed' }
    await savePost(ctx, args.episodeId, { title: args.title, post: args.post })
    await applyEvent(ctx, args.episodeId, { type: 'script_written' })
    if (args.autoApprove) await approveEpisode(ctx, args.episodeId)
    return { title: args.title }
  },
})

// ---------------------------------------------------------------------------
// Publisher: comments back into signals
// ---------------------------------------------------------------------------

export const pollComments = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, args): Promise<{ found: number }> => {
    const personaId = args.personaId as Id<'personas'>
    const publications = await ctx.runQuery(internal.internal.agents.livePublications, { personaId })
    let found = 0
    for (const publication of publications) {
      if (!publication.externalId) continue
      const comments = await platformProvider(publication.platform).comments(publication.externalId)
      found += await ctx.runMutation(internal.internal.agents.storeSignals, {
        personaId,
        mock: providersMode() === 'mock',
        signals: comments.map((comment) => ({
          source: 'comments' as const,
          externalId: comment.externalId,
          title: comment.text.slice(0, 120),
          url: publication.url ?? '',
          summary: `${comment.likes} likes under "${publication.title}" on ${publication.platform}`,
          score: comment.likes * 5 + 5,
          topics: [publication.platform],
        })),
      })
    }
    return { found }
  },
})

export const livePublications = internalQuery({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<Doc<'publications'>[]> => {
    const publications = await ctx.db
      .query('publications')
      .withIndex('by_persona', (q) => q.eq('personaId', args.personaId))
      .collect()
    return publications.filter((publication) => publication.status === 'live')
  },
})

// ---------------------------------------------------------------------------
// Analyst
// ---------------------------------------------------------------------------

export const pullMetrics = internalAction({
  args: { personaId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ snapshots: number; conversions: number; redemptions: number; measured: number; replies: number }> => {
    const personaId = args.personaId as Id<'personas'>
    const { persona } = await ctx.runQuery(internal.internal.data.getPersona, { personaId })
    const publications = await ctx.runQuery(internal.internal.agents.livePublications, { personaId })
    let snapshots = 0
    for (const publication of publications) {
      if (!publication.externalId || !publication.publishedAt) continue
      const counts = await platformProvider(publication.platform).counts({
        externalId: publication.externalId,
        publishedAt: publication.publishedAt,
      })
      const clicks = await ctx.runQuery(internal.internal.agents.clicksForLink, { linkId: publication.linkId })
      await ctx.runMutation(internal.internal.agents.storeSnapshot, {
        personaId,
        episodeId: publication.episodeId,
        publicationId: publication._id,
        platform: publication.platform,
        counts: { ...counts, clicks, signups: 0, paid: 0 },
        mock: providersMode() === 'mock',
      })
      snapshots += 1
    }
    const since = Date.now() - 30 * 24 * 3_600_000
    const clicksSince = await ctx.runQuery(internal.internal.agents.clicksForPersona, { personaId, since })
    const found = await analyticsProvider().conversions({ personaHandle: persona.handle, since, clicksSince })
    const mock = providersMode() === 'mock'
    // Every code the persona was ever given: a retired code stays in the videos that carried it and
    // Polar still accepts it, so its orders keep arriving and keep counting.
    const codes = await ctx.runQuery(internal.internal.agents.discountCodesFor, { personaId })
    const codeStrings = new Set(codes.map((code) => code.code))
    // A purchase made with one of the persona's codes reaches PostHog too. The billing side is the exact
    // source for those, so the PostHog copy is dropped rather than counted twice.
    const viaLink = found.filter((conversion) => {
      if (conversion.kind !== 'paid' || conversion.discountCode === undefined) return true
      const code = normalizeDiscountCode(conversion.discountCode)
      return code === null || !codeStrings.has(code)
    })
    let conversions = await ctx.runMutation(internal.internal.agents.storeConversions, {
      personaId,
      conversions: viaLink.map((conversion) => ({
        via: 'utm' as const,
        kind: conversion.kind,
        distinctId: conversion.distinctId,
        at: conversion.at,
        utm: conversion.utm,
      })),
      mock,
    })
    // Every redemption is one paid conversion, exact and consent-independent. A code string is polled
    // once from its first hand-out; each order belongs to the row that was in force when it was placed.
    let redemptions = 0
    for (const codeString of codeStrings) {
      const rows = codes.filter((code) => code.code === codeString)
      const redeemed = await discountsProvider().redemptions({ code: codeString, since: Math.min(...rows.map((row) => row.createdAt)) })
      redemptions += redeemed.length
      for (const row of rows) {
        const own = redeemed.filter((redemption) => redemptionOwner(rows, redemption.at)?._id === row._id)
        conversions += await ctx.runMutation(internal.internal.agents.storeConversions, {
          personaId,
          conversions: own.map((redemption) => ({
            via: 'code' as const,
            kind: 'paid' as const,
            distinctId: redemption.orderId,
            at: redemption.at,
            episodeId: row.episodeId,
          })),
          mock,
        })
        await ctx.runMutation(internal.internal.agents.setDiscountCodeRedemptions, { discountCodeId: row._id, redemptions: own.length })
      }
    }
    const measured = await ctx.runMutation(internal.internal.agents.measureEpisodes, { personaId })
    const replies = await measureReplies(ctx, personaId)
    await ctx.runAction(internal.internal.agents.evaluateExperiments, { personaId })
    return { snapshots, conversions, redemptions, measured, replies }
  },
})

export const discountCodesFor = internalQuery({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<Doc<'discountCodes'>[]> => discountCodesRule(ctx, args.personaId),
})

export const setDiscountCodeRedemptions = internalMutation({
  args: { discountCodeId: v.id('discountCodes'), redemptions: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.discountCodeId, { redemptions: args.redemptions })
  },
})

export const clicksForLink = internalQuery({
  args: { linkId: v.id('links') },
  handler: async (ctx, args): Promise<number> => (await ctx.db.get(args.linkId))?.clicks ?? 0,
})

export const clicksForPersona = internalQuery({
  args: { personaId: v.id('personas'), since: v.number() },
  handler: async (ctx, args): Promise<number> => {
    const clicks = await ctx.db
      .query('linkClicks')
      .withIndex('by_persona_time', (q) => q.eq('personaId', args.personaId).gte('at', args.since))
      .collect()
    return clicks.length
  },
})

export const storeSnapshot = internalMutation({
  args: {
    personaId: v.id('personas'),
    episodeId: v.id('episodes'),
    publicationId: v.id('publications'),
    platform: platformValidator,
    counts: v.object({
      views: v.number(),
      watchRate: v.number(),
      follows: v.number(),
      likes: v.number(),
      comments: v.number(),
      clicks: v.number(),
      signups: v.number(),
      paid: v.number(),
    }),
    mock: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('metricSnapshots', {
      personaId: args.personaId,
      episodeId: args.episodeId,
      publicationId: args.publicationId,
      platform: args.platform,
      takenAt: Date.now(),
      counts: args.counts,
      mock: args.mock,
    })
  },
})

/**
 * A found conversion names how it was tied to the persona. A UTM one carries
 * the tracked link's parameters and is matched to its episode by campaign
 * slug (ADR 0003); a code one carries the episode its code was bound to.
 */
const foundConversionValidator = v.union(
  v.object({
    via: v.literal('utm'),
    kind: conversionKindValidator,
    distinctId: v.string(),
    at: v.number(),
    utm: v.object({
      source: v.string(),
      medium: v.optional(v.string()),
      campaign: v.optional(v.string()),
      content: v.optional(v.string()),
    }),
  }),
  v.object({
    via: v.literal('code'),
    kind: conversionKindValidator,
    distinctId: v.string(),
    at: v.number(),
    episodeId: v.optional(v.id('episodes')),
  })
)
type FoundConversionArg = Infer<typeof foundConversionValidator>

function episodeOfConversion(conversion: FoundConversionArg, episodes: Doc<'episodes'>[]): Doc<'episodes'> | undefined {
  if (conversion.via === 'code') return episodes.find((candidate) => candidate._id === conversion.episodeId)
  if (!conversion.utm.campaign) return undefined
  return episodes.find((candidate) => candidate.slug === conversion.utm.campaign)
}

export const storeConversions = internalMutation({
  args: {
    personaId: v.id('personas'),
    mock: v.boolean(),
    conversions: v.array(foundConversionValidator),
  },
  handler: async (ctx, args): Promise<number> => {
    let inserted = 0
    const episodes = await ctx.db
      .query('episodes')
      .withIndex('by_persona', (q) => q.eq('personaId', args.personaId))
      .collect()
    for (const conversion of args.conversions) {
      const kind = conversion.kind
      const existing = await ctx.db
        .query('conversions')
        .withIndex('by_distinct', (q) => q.eq('distinctId', conversion.distinctId).eq('kind', kind))
        .first()
      if (existing) continue
      const episode = episodeOfConversion(conversion, episodes)
      await ctx.db.insert('conversions', {
        personaId: args.personaId,
        episodeId: episode?._id,
        variantKey: conversion.via === 'utm' ? (conversion.utm.content ?? episode?.variantKey) : episode?.variantKey,
        kind,
        via: conversion.via,
        distinctId: conversion.distinctId,
        at: conversion.at,
        mock: args.mock,
      })
      inserted += 1
    }
    return inserted
  },
})

/** Published episodes past their measurement window become measured. */
export const measureEpisodes = internalMutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<number> => {
    const episodes = await ctx.db
      .query('episodes')
      .withIndex('by_persona', (q) => q.eq('personaId', args.personaId))
      .collect()
    let measured = 0
    for (const episode of episodes) {
      if (episode.status !== 'published' || !episode.publishedAt) continue
      if (episode.publishedAt + MEASUREMENT_WINDOW_MS > Date.now()) continue
      await ctx.db.patch(episode._id, { measuredAt: Date.now() })
      await applyEvent(ctx, episode._id, { type: 'measured' })
      measured += 1
    }
    return measured
  },
})

export const evaluateExperiments = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, args): Promise<{ decided: number }> => {
    return ctx.runMutation(internal.internal.agents.evaluateExperimentsMutation, { personaId: args.personaId as Id<'personas'> })
  },
})

/**
 * The verdict on the persona's running experiments, after every metrics pull.
 * A decision lands through core `applyExperimentDecision`, the one place a
 * decision lands for the analyst and the operator alike: the winner becomes
 * the persona's default for the dimension, a learning, a journal entry and
 * one chat message. The winner's rate and the runner-up's, at the moment of
 * the decision, go with it, so the strategy review can tell when later data
 * contradicts the winner, and the runner-up's key, which a re-test runs
 * against.
 */
export const evaluateExperimentsMutation = internalMutation({
  args: { personaId: v.id('personas') },
  handler: async (ctx, args): Promise<{ decided: number }> => {
    const experiments = await ctx.db
      .query('experiments')
      .withIndex('by_persona_status', (q) => q.eq('personaId', args.personaId).eq('status', 'running'))
      .collect()
    let decided = 0
    for (const experiment of experiments) {
      const stats = await variantStatsFor(ctx, experiment)
      const decision = decideExperiment(stats, { minExposures: experiment.minExposures, minConfidence: experiment.minConfidence })
      if (!decision) continue
      if (!experiment.variants.some((variant) => variant.key === decision.winnerKey))
        throw new Error(`experiment ${experiment._id} was decided for "${decision.winnerKey}", which is not one of its variants`)
      // The same order decideExperiment ranks by, so the runner-up is the variant the winner was tested against.
      const ranked = [...stats].sort((a, b) => variantRate(b) - variantRate(a))
      const winnerStats = ranked.find((stat) => stat.key === decision.winnerKey)
      const runnerUp = ranked.find((stat) => stat.key !== decision.winnerKey)
      if (!winnerStats || !runnerUp)
        throw new Error(`experiment ${experiment._id} was decided without a winner and a runner-up in its stats`)
      await applyExperimentDecision(
        ctx,
        experiment,
        { ...decision, winnerRate: variantRate(winnerStats), runnerUpRate: variantRate(runnerUp), runnerUpKey: runnerUp.key },
        'analyst',
        analystDecisionNote(experiment, decision)
      )
      decided += 1
    }
    return { decided }
  },
})

/**
 * The weekly strategy review (docs/plan.md, v0.2 item 8). Every rule it
 * applies is deterministic code in core `reviewStrategy` (pillar weights,
 * publish hours, contradicted defaults, the next experiment), so the review
 * calls no model and runs in one mutation: its changes, journal entries and
 * chat message land together or not at all. The outcome is the job's result.
 */
export const reviewStrategy = internalAction({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<ReviewOutcome> => ctx.runMutation(internal.internal.agents.reviewStrategyMutation, args),
})

export const reviewStrategyMutation = internalMutation({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<ReviewOutcome> => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    if (job.kind !== 'review_strategy') throw new Error(`job ${job._id} is a ${job.kind} job, not a review_strategy job`)
    if (!job.personaId) throw new Error(`review_strategy job ${job._id} has no persona`)
    const persona = await ctx.db.get(job.personaId)
    if (!persona) throw new Error(`persona ${job.personaId} not found`)
    return reviewStrategyRule(ctx, persona, Date.now())
  },
})

/** How many of the account's most engaging originals the analyst marks as examples when it learns the voice. */
const LEARNED_EXAMPLES = 5
/** How many of the top and of the newest originals the model reads verbatim. */
const VOICE_READ_POSTS = 30

/**
 * Learn the voice (docs/plan.md, slice 5). Everything countable comes from
 * the counts kept as posts are imported (shared `voiceStatsOf`), and the
 * examples are the originals with the most likes plus reposts; the language
 * model writes only the language, the summary and the traits, from the top
 * and the newest originals verbatim. Nothing here reads every post, so an
 * archive of any size can be learned from. Learning again replaces the voice
 * and every example mark.
 */
export const learnVoice = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, args): Promise<{ language: string; sampleSize: number; examples: number }> => {
    const personaId = args.personaId as Id<'personas'>
    const { persona } = await ctx.runQuery(internal.internal.data.getPersona, { personaId })
    const reading: VoiceReading = await ctx.runQuery(internal.internal.agents.voiceReading, { personaId, read: VOICE_READ_POSTS })
    const stats = voiceStatsOf(voiceSampleOf(reading.counts))
    const draft = await llmProvider().learnVoice({
      persona: {
        name: persona.name,
        handle: persona.handle,
        niche: persona.niche,
        tone: persona.tone,
        bible: persona.bible,
        pillars: persona.pillars,
      },
      stats,
      top: reading.top.map(sampleOf),
      newest: reading.newest.map(sampleOf),
    })
    const examples = reading.top.slice(0, LEARNED_EXAMPLES).map((post) => post._id)
    await ctx.runMutation(internal.internal.agents.storeVoice, {
      personaId,
      voice: {
        ...draft,
        lengthMix: stats.lengthMix,
        emoji: stats.emoji,
        hashtags: stats.hashtags,
        sampleSize: stats.sampleSize,
        learnedAt: Date.now(),
      },
      exampleIds: examples,
    })
    return { language: draft.language, sampleSize: stats.sampleSize, examples: examples.length }
  },
})

interface VoiceReading {
  /** The persona's counts row, null before its first import. */
  counts: Doc<'accountCounts'> | null
  /** The `read` most engaging originals, most engaging first. */
  top: Doc<'accountPosts'>[]
  /** The `read` newest originals that are not among the top, newest first. */
  newest: Doc<'accountPosts'>[]
}

/** What the analyst learns a voice from, in one read: the counts, and the originals the model reads verbatim. */
export const voiceReading = internalQuery({
  args: { personaId: v.id('personas'), read: v.number() },
  handler: async (ctx, args): Promise<VoiceReading> => {
    const counts = await accountCountsOf(ctx, args.personaId)
    const top = await topOriginalsOf(ctx, args.personaId, args.read)
    const topIds = new Set(top.map((post) => post._id))
    // Every top post can be among the newest too, so reading that many more still leaves `read` others.
    const newest = (await newestOriginalsOf(ctx, args.personaId, args.read + top.length))
      .filter((post) => !topIds.has(post._id))
      .slice(0, args.read)
    return { counts, top, newest }
  },
})

/** The learned voice, and exactly these posts as the examples: every earlier mark is cleared. */
export const storeVoice = internalMutation({
  args: { personaId: v.id('personas'), voice: voiceValidator, exampleIds: v.array(v.id('accountPosts')) },
  handler: async (ctx, args) => {
    const marked = await examplePostsOf(ctx, args.personaId)
    for (const post of marked) if (!args.exampleIds.includes(post._id)) await ctx.db.patch(post._id, { example: false })
    for (const id of args.exampleIds) {
      const post = await ctx.db.get(id)
      if (!post || post.personaId !== args.personaId) throw new Error(`account post ${id} is not ${args.personaId}'s`)
      await ctx.db.patch(id, { example: true })
    }
    await ctx.db.patch(args.personaId, { voice: args.voice })
  },
})

function sampleOf(post: Doc<'accountPosts'>): AccountPostSample {
  return { parts: post.parts, lang: post.lang ?? null, likes: post.likes, reposts: post.reposts }
}

// ---------------------------------------------------------------------------
// Persona chat
// ---------------------------------------------------------------------------

/** How many earlier messages the persona reads before it answers. */
const CHAT_HISTORY = 20

/**
 * Every operator message is read once (docs/plan.md, slice 7). The action
 * reads the chat and the changeable plan, asks the language model what the
 * message asks for, and for a directive or a conversation also writes the
 * persona's reply, so the one mutation that follows only applies and stores:
 * a change and the words that report it land in the same transaction.
 * Nothing here throws at the operator. A message the model cannot read, or a
 * change that fails, still gets a persona message that says so.
 */
export const handleMessage = internalAction({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args): Promise<void> => {
    const chat: ChatReading = await ctx.runQuery(internal.internal.agents.chatReading, { messageId: args.messageId })
    const understood = await understand(chat)
    if (!understood.ok) {
      await ctx.runMutation(internal.internal.agents.storeReply, {
        personaId: chat.personaId,
        text: `I could not read that just now: ${understood.error}`,
      })
      return
    }
    try {
      await ctx.runMutation(internal.internal.agents.applyIntent, {
        messageId: args.messageId,
        intent: understood.intent,
        reply: understood.reply,
      })
    } catch (error) {
      // applyChatIntent turns every refusal into a reply, so this is a bug: the operator still hears about
      // it, nothing changed (the mutation rolled back), and the rethrow keeps it in the logs.
      await ctx.runMutation(internal.internal.agents.storeReply, {
        personaId: chat.personaId,
        text: `Something went wrong while I worked on that, so nothing changed: ${errorText(error)}`,
      })
      throw error
    }
  },
})

interface ChatReading {
  personaId: Id<'personas'>
  persona: ScriptBrief['persona']
  /** The message to read. */
  text: string
  /** The chat before it, oldest first. */
  history: ChatTurn[]
  plan: PlanRow[]
}

/** The message, the chat before it, and the plan rows the interpreter may change (core `changeablePlan`). */
export const chatReading = internalQuery({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args): Promise<ChatReading> => {
    const message = await ctx.db.get(args.messageId)
    if (!message) throw new Error(`message ${args.messageId} not found`)
    if (message.author !== 'operator') throw new Error(`message ${message._id} is the persona's own; only operator messages are read`)
    const persona = await ctx.db.get(message.personaId)
    if (!persona) throw new Error(`persona ${message.personaId} not found`)
    const earlier = await ctx.db
      .query('messages')
      .withIndex('by_persona', (q) => q.eq('personaId', persona._id).lt('_creationTime', message._creationTime))
      .order('desc')
      .take(CHAT_HISTORY)
    const plan = await changeablePlan(ctx, persona._id)
    return {
      personaId: persona._id,
      persona: personaBriefOf(persona),
      text: message.text,
      history: earlier.reverse().map((turn) => ({ author: turn.author, text: turn.text })),
      plan: plan.map((episode) => ({
        id: episode._id,
        weekday: weekdayOf(episode.plannedFor),
        plannedFor: episode.plannedFor,
        kind: episode.kind,
        title: episode.title,
        pillar: episode.pillar ?? null,
        status: EPISODE_STATUS_LABELS[episode.status],
      })),
    }
  },
})

/** What the model made of a message: an intent, with the persona's reply when the intent is a directive or a conversation. */
type Understood = { ok: true; intent: ChatIntent; reply: string | null } | { ok: false; error: string }

async function understand(chat: ChatReading): Promise<Understood> {
  const llm = llmProvider()
  try {
    const intent = validIntent(await llm.interpret(chat))
    if (intent.kind !== 'directive' && intent.kind !== 'conversation') return { ok: true, intent, reply: null }
    const reply = await llm.reply({
      persona: chat.persona,
      history: [...chat.history, { author: 'operator', text: chat.text }],
      directive: intent.kind === 'directive' ? directiveText(intent.text, chat.text) : undefined,
    })
    return { ok: true, intent, reply }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

/** The words a directive is stored with, as core `applyDirective` picks them: the restatement, or the message when it is empty. */
function directiveText(restated: string, message: string): string {
  const text = restated.trim()
  return text === '' ? message : text
}

/** The interpreter's answer, held to the shared schema. One that does not fit changes nothing: it is conversation. */
function validIntent(answer: unknown): ChatIntent {
  const parsed = chatIntentSchema.safeParse(answer)
  if (parsed.success) return parsed.data
  console.warn(`The interpreter's answer did not fit the chat intent schema; it is read as conversation. ${parsed.error.message}`)
  return { kind: 'conversation' }
}

/**
 * Applies what the message asks for and stores the persona's reply with the
 * episode, job or directive it is about; core `applyChatIntent` does both. The
 * reply of a directive or a conversation was written in the action and comes
 * in as `reply`; every other kind is answered by the core and takes null.
 */
export const applyIntent = internalMutation({
  // The intent was checked against chatIntentSchema in the action and is parsed again here, at the boundary.
  args: { messageId: v.id('messages'), intent: v.any(), reply: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<void> => {
    const message = await ctx.db.get(args.messageId)
    if (!message) throw new Error(`message ${args.messageId} not found`)
    const persona = await ctx.db.get(message.personaId)
    if (!persona) throw new Error(`persona ${message.personaId} not found`)
    const intent = chatIntentSchema.parse(args.intent)
    await applyChatIntent(ctx, persona, message._id, intent, args.reply)
  },
})

/** A persona message that belongs to no change and no task: the answer when a message could not be read or applied. */
export const storeReply = internalMutation({
  args: { personaId: v.id('personas'), text: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await insertPersonaMessage(ctx, { personaId: args.personaId, text: args.text })
  },
})

async function insertPersonaMessage(
  ctx: MutationCtx,
  args: { personaId: Id<'personas'>; text: string; jobId?: Id<'jobs'> }
): Promise<Id<'messages'>> {
  return ctx.db.insert('messages', {
    personaId: args.personaId,
    author: 'persona',
    text: args.text,
    jobId: args.jobId,
    createdAt: Date.now(),
  })
}

/** A refusal's own words, or the message of anything else; the chat shows it as it is, like the studio does. */
function errorText(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === 'string') return error.data
  return error instanceof Error ? error.message : String(error)
}

function personaBriefOf(persona: Doc<'personas'>): ScriptBrief['persona'] {
  return {
    name: persona.name,
    handle: persona.handle,
    niche: persona.niche,
    tone: persona.tone,
    bible: persona.bible,
    pillars: persona.pillars,
  }
}

// ---------------------------------------------------------------------------
// Chat tasks: a report one agent writes and posts back in the persona's chat
// ---------------------------------------------------------------------------

/** How many unused signals a research brief reads, freshest first. */
const RESEARCH_BRIEF_SIGNALS = 10
/** How far back a comment digest and an analytics summary look. */
const TASK_WINDOW_DAYS = 7
/** How many of the window's comments the writer of a digest reads, most liked first; the count covers them all. */
const COMMENT_DIGEST_COMMENTS = 30

export const researchBrief = internalAction({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<{ messageId: Id<'messages'> }> => runChatTask(ctx, args.jobId, 'research_brief'),
})

export const commentDigest = internalAction({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<{ messageId: Id<'messages'> }> => runChatTask(ctx, args.jobId, 'comment_digest'),
})

export const analyticsSummary = internalAction({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<{ messageId: Id<'messages'> }> => runChatTask(ctx, args.jobId, 'analytics_summary'),
})

/**
 * Gathers the task's data in code, has the model put it in words, and posts
 * the words in the persona's chat with the job; the message is the job's
 * result. A task that fails posts nothing here and throws: dispatch fails the
 * job and posts why in the chat (core `reportChatTaskFailure`), so the
 * operator who asked is never left waiting and hears it once.
 */
async function runChatTask(ctx: ActionCtx, jobId: Id<'jobs'>, task: ChatTask): Promise<{ messageId: Id<'messages'> }> {
  const report: TaskReportArgs = await ctx.runQuery(internal.internal.agents.taskReading, { jobId })
  if (report.task !== task) throw new Error(`job ${jobId} is a ${report.task} job, not a ${task} job`)
  const text = await llmProvider().taskReport(report)
  const messageId: Id<'messages'> = await ctx.runMutation(internal.internal.agents.storeTaskMessage, { jobId, text })
  return { messageId }
}

/** The persona, the topic and the data of a chat task job, as the report's writer reads them. */
export const taskReading = internalQuery({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<TaskReportArgs> => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    if (!isChatTask(job.kind)) throw new Error(`job ${job._id} is a ${job.kind} job, not a chat task`)
    if (!job.personaId) throw new Error(`chat task job ${job._id} has no persona`)
    const persona = await ctx.db.get(job.personaId)
    if (!persona) throw new Error(`persona ${job.personaId} not found`)
    const topic = topicOf(job.payload)
    const brief = personaBriefOf(persona)
    const now = Date.now()
    if (job.kind === 'research_brief') {
      return { persona: brief, task: job.kind, topic, data: { signals: await unusedSignals(ctx, persona._id, topic, now) } }
    }
    if (job.kind === 'comment_digest') {
      const comments = await commentsSince(ctx, persona._id, now - TASK_WINDOW_DAYS * 86_400_000)
      return {
        persona: brief,
        task: job.kind,
        topic,
        data: { days: TASK_WINDOW_DAYS, total: comments.length, comments: comments.slice(0, COMMENT_DIGEST_COMMENTS).map(taskSignalOf) },
      }
    }
    // The report page's own reading over the window (core `reportWindow`), so the chat and the page never disagree about a week.
    const window = await reportWindow(ctx, persona, TASK_WINDOW_DAYS, now)
    return { persona: brief, task: job.kind, topic, data: { days: window.days, funnel: window.funnel, currency: window.currency } }
  },
})

/** The chat task's report in the persona's chat, with the job it answers. */
export const storeTaskMessage = internalMutation({
  args: { jobId: v.id('jobs'), text: v.string() },
  handler: async (ctx, args): Promise<Id<'messages'>> => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    if (!job.personaId) throw new Error(`chat task job ${job._id} has no persona`)
    return insertPersonaMessage(ctx, { personaId: job.personaId, text: args.text, jobId: job._id })
  },
})

/** A chat task's topic; the payload is stored as v.any(), so it is narrowed here. Null when the message named none. */
function topicOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) throw new Error('job payload is not an object')
  if (!('topic' in payload) || payload.topic === undefined) return null
  if (typeof payload.topic !== 'string') throw new Error('a chat task topic is not a string')
  return payload.topic
}

/**
 * The persona's freshest signals nobody used yet (shared `signalFreshness`),
 * those that mention the topic when there is one. A cold signal still counts
 * here, last: the operator asked what there is, and an old story is still an
 * answer.
 */
async function unusedSignals(ctx: QueryCtx, personaId: Id<'personas'>, topic: string | null, now: number): Promise<TaskSignal[]> {
  const signals = await ctx.db
    .query('signals')
    .withIndex('by_persona_status', (q) => q.eq('personaId', personaId).eq('status', 'new'))
    // Newest first, so two signals of the same freshness rank the newer one first.
    .order('desc')
    .collect()
  const terms = topic === null ? null : topicTerms(topic)
  return signals
    .filter((signal) => terms === null || mentionsAny(signal, terms))
    .map((signal) => ({ signal, freshness: signalFreshness(signal, now) }))
    .sort((a, b) => b.freshness - a.freshness)
    .slice(0, RESEARCH_BRIEF_SIGNALS)
    .map((ranked) => taskSignalOf(ranked.signal))
}

/** Where a topic names more than one subject: "Make vs n8n", "Zapier, Make and n8n". */
const TOPIC_CONNECTOR = /\s*,\s*|\s+(?:vs\.?|versus|and|or)\s+/i
/** An article opening a subject says nothing about it: "the n8n error trigger" is about "n8n error trigger". */
const LEADING_ARTICLE = /^(?:the|a|an)\s+/i

/**
 * The subjects of a topic; a signal has to mention one of them whole. A
 * comparison such as "Make vs n8n" is about either side, so the topic splits
 * at its connectors, but never at a plain space: a single word of a phrase
 * ("the", "sign" of "sign-off") is part of too many titles to filter by. A
 * topic of commas alone names no subject, so no signal mentions it.
 */
function topicTerms(topic: string): string[] {
  return topic
    .toLowerCase()
    .split(TOPIC_CONNECTOR)
    .map((subject) => subject.trim().replace(LEADING_ARTICLE, ''))
    .filter((subject) => subject !== '')
}

function mentionsAny(signal: Doc<'signals'>, terms: string[]): boolean {
  const texts = [signal.title, ...signal.topics].map((text) => text.toLowerCase())
  return terms.some((term) => texts.some((text) => text.includes(term)))
}

/** Every comment the publisher read under the persona's publications since `since`, most liked first. */
async function commentsSince(ctx: QueryCtx, personaId: Id<'personas'>, since: number): Promise<Doc<'signals'>[]> {
  const comments = await ctx.db
    .query('signals')
    .withIndex('by_persona_external', (q) => q.eq('personaId', personaId).eq('source', 'comments'))
    .collect()
  return comments.filter((comment) => comment.foundAt >= since).sort((a, b) => b.score - a.score)
}

function taskSignalOf(signal: Doc<'signals'>): TaskSignal {
  return { source: signal.source, title: signal.title, summary: signal.summary, url: signal.url, topics: signal.topics }
}
