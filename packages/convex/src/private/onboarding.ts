import { v } from 'convex/values'
import { freeHandle, handleFromName, proposalProblems, type PersonaProposal } from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { action, internalQuery, mutation, query } from '../_generated/server'
import { createPersona, planFirstWeeks } from '../core/personas'
import { FIRST_WORKSPACE, ensureWorkspace } from '../core/workspace'
import { refusal } from '../lib/errors'
import { personaColorValidator, platformFormatValidator } from '../lib/validators'
import { llmProvider } from '../providers/llm'

/**
 * Onboarding (docs/plan.md, slice 13): the flow that builds the roster on the
 * first run and adds one persona at a time after it. The writer proposes a
 * persona from a niche and an audience; the operator edits it in place, sets
 * the platforms, the sponsor dial and the hours, and creating it plans its
 * first weeks.
 */

/** How many episodes a new persona publishes unsponsored before the dial applies (CONTEXT.md, "Sponsor dial"). */
const SPONSOR_RAMP_EPISODES = 10

/** What the flow starts from: the roster so far, its colors and handles, and the sponsor a proposal names. */
export const start = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await ctx.db.query('workspaces').first()
    const personas = await ctx.db.query('personas').collect()
    return {
      sponsorName: workspace?.sponsorName ?? FIRST_WORKSPACE.sponsorName,
      roster: personas.map((persona) => ({ _id: persona._id, name: persona.name, handle: persona.handle, color: persona.color })),
    }
  },
})

export const proposalContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const workspace = await ctx.db.query('workspaces').first()
    const personas = await ctx.db.query('personas').collect()
    return {
      sponsorName: workspace?.sponsorName ?? FIRST_WORKSPACE.sponsorName,
      roster: personas.map((persona) => ({ name: persona.name, handle: persona.handle, niche: persona.niche })),
    }
  },
})

/**
 * The writer's proposal for a niche and an audience. Nothing is stored: the
 * operator edits it and creates the persona. The handle is made to fit a
 * handle's pattern and to be free, so the proposal never starts refused.
 */
export const propose = action({
  args: { niche: v.string(), audience: v.string() },
  handler: async (ctx, args): Promise<PersonaProposal> => {
    const niche = args.niche.trim()
    const audience = args.audience.trim()
    if (!niche) throw refusal('Say what the persona is about: its niche.')
    if (!audience) throw refusal('Say who the persona talks to: its audience.')
    const context = await ctx.runQuery(internal.private.onboarding.proposalContext, {})
    const proposal = await llmProvider().proposePersona({ niche, audience, ...context })
    const handle = handleFromName(proposal.handle) || handleFromName(proposal.name)
    return {
      ...proposal,
      handle: freeHandle(
        handle,
        context.roster.map((persona) => persona.handle)
      ),
    }
  },
})

/**
 * Creates one persona of the flow and plans its first weeks. On the first
 * run there is no workspace yet: it is made from FIRST_WORKSPACE with the
 * studio's origin for its links.
 */
export const create = mutation({
  args: {
    appUrl: v.string(),
    niche: v.string(),
    audience: v.string(),
    name: v.string(),
    handle: v.string(),
    color: personaColorValidator,
    tone: v.string(),
    pillars: v.array(v.string()),
    bio: v.string(),
    bible: v.string(),
    formats: v.array(platformFormatValidator),
    voiceId: v.string(),
    sponsorDial: v.number(),
    episodesPerWeek: v.number(),
    timezone: v.string(),
  },
  handler: async (ctx, args): Promise<Id<'personas'>> => {
    const { appUrl, ...fields } = args
    const taken = (await ctx.db.query('personas').collect()).map((persona) => persona.handle)
    const problems = proposalProblems(fields, taken)
    if (problems.length > 0) throw refusal(problems.join(' '))
    if (!(fields.sponsorDial >= 0 && fields.sponsorDial <= 1)) throw refusal('The sponsor dial is between 0 and 1.')
    if (!(Number.isInteger(fields.episodesPerWeek) && fields.episodesPerWeek >= 1 && fields.episodesPerWeek <= 7))
      throw refusal('A persona publishes 1 to 7 videos a week.')
    const workspace = await ensureWorkspace(ctx, appUrl)
    const persona = await createPersona(ctx, workspace, {
      ...fields,
      name: fields.name.trim(),
      niche: fields.niche.trim(),
      audience: fields.audience.trim(),
      tone: fields.tone.trim(),
      bio: fields.bio.trim(),
      bible: fields.bible.trim(),
      sponsorRampEpisodes: SPONSOR_RAMP_EPISODES,
      autoApprove: false,
      autoPublish: false,
    })
    await planFirstWeeks(ctx, persona, Date.now())
    return persona._id
  },
})
