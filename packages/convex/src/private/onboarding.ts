import { v } from 'convex/values'
import {
  REFERENCES_MAX,
  REFERENCE_TAG,
  SPONSOR_RAMP_EPISODES,
  appearanceProblem,
  assetFileProblem,
  assetKindOf,
  assetNameFromFile,
  freeHandle,
  handleFromName,
  isReferenceKind,
  proposalProblems,
  voiceDescriptionProblem,
  type PersonaProposal,
} from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { action, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { addUploadedAsset } from '../core/assets'
import { createPersona, planFirstWeeks } from '../core/personas'
import { FIRST_WORKSPACE, ensureWorkspace } from '../core/workspace'
import { refusal } from '../lib/errors'
import { enqueueJob } from '../jobs/queue'
import { appearanceStyleValidator, personaColorValidator, platformFormatValidator } from '../lib/validators'
import { llmProvider } from '../providers/llm'

/**
 * Onboarding (docs/plan.md, slice 13): the flow that builds the roster on the
 * first run and adds one persona at a time after it. The writer proposes a
 * persona from a niche and an audience; the operator edits it in place, sets
 * the platforms, the sponsor dial and the hours, and creating it plans its
 * first weeks.
 */

/**
 * The sponsor a proposal names and the roster so far. On the first run there
 * is no workspace yet, and the sponsor is the one the first persona will make it with.
 */
async function rosterOf(ctx: QueryCtx): Promise<{ sponsorName: string; personas: Doc<'personas'>[] }> {
  const workspace = await ctx.db.query('workspaces').first()
  return { sponsorName: workspace?.sponsorName ?? FIRST_WORKSPACE.sponsorName, personas: await ctx.db.query('personas').collect() }
}

/** What the flow starts from: the roster so far, its colors and handles, and the sponsor a proposal names. */
export const start = query({
  args: {},
  handler: async (ctx) => {
    const { sponsorName, personas } = await rosterOf(ctx)
    return {
      sponsorName,
      roster: personas.map((persona) => ({ _id: persona._id, name: persona.name, handle: persona.handle, color: persona.color })),
    }
  },
})

/** What the writer reads before it proposes: the sponsor, and the roster it must not repeat. */
export const proposalContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { sponsorName, personas } = await rosterOf(ctx)
    return { sponsorName, roster: personas.map((persona) => ({ name: persona.name, handle: persona.handle, niche: persona.niche })) }
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

/** What creating a persona ends with: the persona, or reference files the library does not take, which are gone again. */
type CreateOutcome = { status: 'created'; personaId: Id<'personas'> } | { status: 'refused'; message: string }

/**
 * Creates one persona of the flow and plans its first weeks. On the first
 * run there is no workspace yet: it is made from FIRST_WORKSPACE with the
 * studio's origin for its links. The reference files go into the persona's
 * asset library, tagged as references, in the operator's order, and make its
 * look. A voice given as a description is made by the voice provider on the
 * runner (a design_voice job); until then the persona has no voice id.
 *
 * A reference the library does not take is deleted and the refusal returned,
 * not thrown, so the delete is not rolled back; every other refusal is
 * thrown before anything is stored, and the studio sends the same files
 * again.
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
    style: appearanceStyleValidator,
    references: v.array(v.object({ storageId: v.id('_storage'), fileName: v.string() })),
    voice: v.union(
      v.object({ kind: v.literal('id'), voiceId: v.string() }),
      v.object({ kind: v.literal('description'), description: v.string() })
    ),
    formats: v.array(platformFormatValidator),
    sponsorDial: v.number(),
    episodesPerWeek: v.number(),
    timezone: v.string(),
  },
  handler: async (ctx, args): Promise<CreateOutcome> => {
    const { appUrl, style, references, voice, ...fields } = args
    const taken = (await ctx.db.query('personas').collect()).map((persona) => persona.handle)
    const problems = proposalProblems(fields, taken)
    if (problems.length > 0) throw refusal(problems.join(' '))
    if (!(fields.sponsorDial >= 0 && fields.sponsorDial <= 1)) throw refusal('The sponsor dial is between 0 and 1.')
    if (!(Number.isInteger(fields.episodesPerWeek) && fields.episodesPerWeek >= 1 && fields.episodesPerWeek <= 7))
      throw refusal('A persona publishes 1 to 7 videos a week.')
    const mismatch = appearanceProblem(style, fields.formats)
    if (mismatch) throw refusal(mismatch)
    if (style === 'voice_only' && references.length > 0) throw new Error('a persona with no presenter takes no references')
    if (references.length > REFERENCES_MAX) throw refusal(`Give at most ${REFERENCES_MAX} references.`)
    const voiceProblem =
      voice.kind === 'id'
        ? voice.voiceId.trim()
          ? null
          : 'Give the voice id, or describe the voice.'
        : voiceDescriptionProblem(voice.description)
    if (voiceProblem) throw refusal(voiceProblem)

    const refused = await referenceProblem(ctx, references)
    if (refused) {
      for (const reference of references) if (await ctx.db.system.get(reference.storageId)) await ctx.storage.delete(reference.storageId)
      return { status: 'refused', message: refused }
    }

    const workspace = await ensureWorkspace(ctx, appUrl)
    const persona = await createPersona(ctx, workspace, {
      ...fields,
      name: fields.name.trim(),
      niche: fields.niche.trim(),
      audience: fields.audience.trim(),
      tone: fields.tone.trim(),
      bio: fields.bio.trim(),
      bible: fields.bible.trim(),
      ...(voice.kind === 'id' ? { voiceId: voice.voiceId.trim() } : { voiceDescription: voice.description.trim() }),
      sponsorRampEpisodes: SPONSOR_RAMP_EPISODES,
      autoApprove: false,
      autoPublish: false,
    })
    const referenceAssetIds: Id<'assets'>[] = []
    const now = Date.now()
    for (const reference of references) {
      const outcome = await addUploadedAsset(ctx, persona, {
        storageId: reference.storageId,
        name: assetNameFromFile(reference.fileName) || `${persona.name} reference`,
        tags: [REFERENCE_TAG],
        note: `How ${persona.name} looks: the avatar provider reads it for every take.`,
        now,
      })
      // referenceProblem checked every file with the library's own rules, so a refusal here is a bug.
      if (outcome.status === 'refused') throw new Error(`reference ${reference.fileName} was refused after its check: ${outcome.message}`)
      referenceAssetIds.push(outcome.assetId)
    }
    await ctx.db.patch(persona._id, { appearance: { style, referenceAssetIds } })
    if (voice.kind === 'description') {
      await enqueueJob(ctx, {
        kind: 'design_voice',
        payload: { personaId: persona._id, personaName: persona.name, description: voice.description.trim() },
        personaId: persona._id,
      })
    }
    await planFirstWeeks(ctx, persona, now)
    return { status: 'created', personaId: persona._id }
  },
})

/** The first reference the library or a look does not take, in the operator's words; none when all of them fit. */
async function referenceProblem(
  ctx: MutationCtx,
  references: readonly { storageId: Id<'_storage'>; fileName: string }[]
): Promise<string | null> {
  for (const reference of references) {
    const file = await ctx.db.system.get(reference.storageId)
    if (!file) return `${reference.fileName} did not arrive; add it again.`
    const contentType = file.contentType ?? ''
    const problem = assetFileProblem({ contentType, size: file.size })
    if (problem) return `${reference.fileName}: ${problem}`
    const kind = assetKindOf(contentType)
    if (kind === null || !isReferenceKind(kind))
      return `${reference.fileName} is no picture or clip: a reference shows how the persona looks.`
  }
  return null
}
