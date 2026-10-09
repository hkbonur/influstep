import { v, type Validator } from 'convex/values'
import {
  AGENT_ROLES,
  ASPECT_RATIOS,
  CHECKLIST_STATUSES,
  CONVERSION_KINDS,
  EPISODE_STATUSES,
  EXPERIMENT_KINDS,
  EXPERIMENT_STATUSES,
  JOB_KIND_LIST,
  JOB_RUNTIMES,
  JOB_STATUSES,
  METRIC_KEYS,
  PLATFORMS,
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

export const checklistActionValidator = v.union(
  v.object({ kind: v.literal('open_browser'), url: v.string() }),
  v.object({ kind: v.literal('set_provider_key'), key: v.string() })
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
