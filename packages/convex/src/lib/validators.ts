import { v, type Validator } from 'convex/values'
import {
  AGENT_ROLES,
  ASPECT_RATIOS,
  CHECKLIST_STATUSES,
  CONVERSION_KINDS,
  CONVERSION_VIAS,
  DELIVERIES,
  EPISODE_KINDS,
  EPISODE_STATUSES,
  EXPERIMENT_KINDS,
  EXPERIMENT_STATUSES,
  JOB_KIND_LIST,
  JOB_RUNTIMES,
  JOB_STATUSES,
  METRIC_KEYS,
  PERSONA_COLORS,
  PLATFORMS,
  POST_KINDS,
  SIGNAL_SOURCES,
  SIGNAL_STATUSES,
  SPONSOR_SEGMENTS,
} from '@influstep/shared'

/** One validator per shared enum, so the schema and the app read the same list. */
function literals<const T extends readonly string[]>(values: T): Validator<T[number]> {
  const [first, ...rest] = values.map((value) => v.literal(value))
  if (!first) throw new Error('literals() needs at least one value')
  if (rest.length === 0) return first as Validator<T[number]>
  return v.union(first, ...rest) as Validator<T[number]>
}

export const episodeStatusValidator = literals(EPISODE_STATUSES)
export const sponsorSegmentValidator = literals(SPONSOR_SEGMENTS)
export const platformValidator = literals(PLATFORMS)
export const aspectRatioValidator = literals(ASPECT_RATIOS)
export const agentRoleValidator = literals(AGENT_ROLES)
export const jobRuntimeValidator = literals(JOB_RUNTIMES)
export const jobStatusValidator = literals(JOB_STATUSES)
export const jobKindValidator = literals(JOB_KIND_LIST)
export const signalSourceValidator = literals(SIGNAL_SOURCES)
export const signalStatusValidator = literals(SIGNAL_STATUSES)
export const metricKeyValidator = literals(METRIC_KEYS)
export const experimentKindValidator = literals(EXPERIMENT_KINDS)
export const experimentStatusValidator = literals(EXPERIMENT_STATUSES)
export const checklistStatusValidator = literals(CHECKLIST_STATUSES)
export const conversionKindValidator = literals(CONVERSION_KINDS)
export const conversionViaValidator = literals(CONVERSION_VIAS)
export const deliveryValidator = literals(DELIVERIES)
export const personaColorValidator = literals(PERSONA_COLORS)
export const episodeKindValidator = literals(EPISODE_KINDS)
export const postKindValidator = literals(POST_KINDS)

/** X's post cadence (shared `XCadence`). Ranges are checked by core/formats.ts. */
export const xCadenceValidator = v.object({
  postsPerDay: v.number(),
  kinds: v.array(postKindValidator),
})

/** A persona's format for one platform (shared `PlatformFormat`). Ranges, and cadence only on X, are checked by core/formats.ts. */
export const platformFormatValidator = v.object({
  platform: platformValidator,
  lengthSec: v.number(),
  aspect: aspectRatioValidator,
  delivery: deliveryValidator,
  hookNote: v.string(),
  publishHour: v.number(),
  cadence: v.optional(xCadenceValidator),
})

/** A post as written, exactly what X receives (shared `EpisodePost`); shared `postProblems` says whether X takes it. */
export const episodePostValidator = v.object({
  parts: v.array(v.string()),
  cardTitle: v.optional(v.string()),
})

/** The format an episode was scripted to (shared `EpisodeFormat`): its length, delivery, and one frozen cut per platform. */
export const episodeFormatValidator = v.object({
  lengthSec: v.number(),
  delivery: deliveryValidator,
  cuts: v.array(v.object({ platform: platformValidator, aspect: aspectRatioValidator })),
})

/** The writer's beats: a named tool and what to show. Stored so the shots can be derived again for another delivery. */
export const shotPlanValidator = v.array(v.object({ title: v.string(), voiceover: v.string(), tool: v.string(), url: v.string() }))

export const scriptValidator = v.object({
  hook: v.string(),
  body: v.string(),
  sponsor: v.string(),
  cta: v.string(),
})

const recipeStepValidator = v.union(
  v.object({ step: v.literal('goto'), url: v.string() }),
  v.object({ step: v.literal('click'), selector: v.string() }),
  v.object({ step: v.literal('type'), selector: v.string(), text: v.string() }),
  v.object({ step: v.literal('wait'), ms: v.number() }),
  v.object({ step: v.literal('scroll'), y: v.number() })
)

export const shotValidator = v.union(
  v.object({ kind: v.literal('screen'), id: v.string(), title: v.string(), voiceover: v.string(), recipe: v.array(recipeStepValidator) }),
  v.object({ kind: v.literal('avatar'), id: v.string(), title: v.string(), voiceover: v.string() }),
  v.object({ kind: v.literal('title'), id: v.string(), title: v.string(), voiceover: v.string() })
)

export const renderValidator = v.object({
  aspect: aspectRatioValidator,
  storageId: v.id('_storage'),
  durationSec: v.number(),
  mock: v.boolean(),
})

export const variantValidator = v.object({
  key: v.string(),
  label: v.string(),
  description: v.string(),
  isControl: v.boolean(),
})

export const decisionValidator = v.object({
  winnerKey: v.string(),
  lift: v.number(),
  confidence: v.number(),
  note: v.string(),
  decidedAt: v.number(),
  byOperator: v.boolean(),
})

/**
 * What a checklist item's button does: open the runner's browser for a
 * sign-in, send the operator to the Providers page for a key, or link a page
 * the operator reads and acts on by hand (the studio opens it in a new tab;
 * the runner never does).
 */
export const checklistActionValidator = v.union(
  v.object({ kind: v.literal('open_browser'), url: v.string() }),
  v.object({ kind: v.literal('set_provider_key'), key: v.string() }),
  v.object({ kind: v.literal('visit'), url: v.string() })
)

export const metricCountsValidator = v.object({
  views: v.number(),
  watchRate: v.number(),
  follows: v.number(),
  likes: v.number(),
  comments: v.number(),
  clicks: v.number(),
  signups: v.number(),
  paid: v.number(),
})
