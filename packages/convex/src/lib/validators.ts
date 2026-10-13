import { v, type Validator } from 'convex/values'
import {
  ACCOUNT_POST_SOURCES,
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
  HABITS,
  JOB_KIND_LIST,
  JOB_RUNTIMES,
  JOB_STATUSES,
  JOURNAL_ACTORS,
  JOURNAL_KINDS,
  MEMORY_KINDS,
  MEMORY_STATUSES,
  METRIC_KEYS,
  PERSONA_COLORS,
  PLATFORMS,
  POST_INTENTS,
  POST_KINDS,
  POST_LENGTHS,
  PUBLICATION_STATUSES,
  SIGNAL_SOURCES,
  SIGNAL_STATUSES,
  SPONSOR_SEGMENTS,
  type Beat,
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
export const postIntentValidator = literals(POST_INTENTS)
export const postLengthValidator = literals(POST_LENGTHS)
export const habitValidator = literals(HABITS)
export const accountPostSourceValidator = literals(ACCOUNT_POST_SOURCES)
export const publicationStatusValidator = literals(PUBLICATION_STATUSES)
export const journalKindValidator = literals(JOURNAL_KINDS)
export const actorValidator = literals(JOURNAL_ACTORS)
export const memoryKindValidator = literals(MEMORY_KINDS)
export const memoryStatusValidator = literals(MEMORY_STATUSES)

/** X's post cadence (shared `XCadence`). Ranges, and each kind and intent once, are checked by core/formats.ts. */
export const xCadenceValidator = v.object({
  postsPerDay: v.number(),
  kinds: v.array(postKindValidator),
  intents: v.array(postIntentValidator),
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

/** The share of each post length (shared `LengthMix`). */
export const lengthMixValidator = v.object({ short: v.number(), medium: v.number(), long: v.number() })

/**
 * An X persona's voice (shared `Voice`): the counted part from shared
 * `voiceStats`, the language, summary and traits the analyst wrote and the
 * operator edits (shared `voiceEditProblems` checks them).
 */
export const voiceValidator = v.object({
  language: v.string(),
  summary: v.string(),
  traits: v.array(v.string()),
  lengthMix: lengthMixValidator,
  emoji: habitValidator,
  hashtags: habitValidator,
  sampleSize: v.number(),
  learnedAt: v.number(),
})

/** Imported posts by where they came from (shared ACCOUNT_POST_SOURCES), every source present. */
export const accountSourceCountsValidator = v.object({ archive: v.number(), paste: v.number(), api: v.number(), mock: v.number() })

/** The voice counts over an account's originals (shared `VoiceCounts`): originals of each length, and those with an emoji or a hashtag. */
export const voiceCountsValidator = v.object({
  lengths: v.object({ short: v.number(), medium: v.number(), long: v.number() }),
  withEmoji: v.number(),
  withHashtag: v.number(),
})

/** One post of an account's history as the studio parsed it (shared `ImportedPost`). */
export const importedPostValidator = v.object({
  externalId: v.string(),
  parts: v.array(v.string()),
  postedAt: v.number(),
  likes: v.number(),
  reposts: v.number(),
  replies: v.number(),
  isReply: v.boolean(),
  lang: v.union(v.string(), v.null()),
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

/** One beat of a video's script (shared `Beat`): what is spoken over it, and the tool and URL it shows. */
export const beatValidator = v.object({ title: v.string(), voiceover: v.string(), tool: v.string(), url: v.string() }) satisfies Validator<
  Beat,
  'required',
  keyof Beat
>

/** A video's beats, the only script: the shots, the voice track and the hook are derived from them. */
export const shotPlanValidator = v.array(beatValidator)

/** The part of a beat the operator edits: its title and its spoken line. The tool and URL stay the writer's. */
export const beatEditValidator = v.object({ title: v.string(), voiceover: v.string() })

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

/**
 * One arm of an experiment; a length variant carries the factor its episodes'
 * length is scaled by (shared `variantLength`), and a publish time variant the
 * hours its videos move from the platform's usual hour (core/formats.ts
 * `publishHourFor`).
 */
export const variantValidator = v.object({
  key: v.string(),
  label: v.string(),
  description: v.string(),
  isControl: v.boolean(),
  lengthFactor: v.optional(v.number()),
  hourOffset: v.optional(v.number()),
})

/**
 * How an experiment was decided. The winner's and the runner-up's rates at the
 * decision let the strategy review notice when the default stops beating what
 * it beat (shared `contradicts`), and the runner-up's key is what a re-test
 * runs against; an operator's override has none of them. Decisions from before
 * the key was stored have the rates without it.
 */
export const decisionValidator = v.object({
  winnerKey: v.string(),
  lift: v.number(),
  confidence: v.number(),
  note: v.string(),
  decidedAt: v.number(),
  byOperator: v.boolean(),
  winnerRate: v.optional(v.number()),
  runnerUpRate: v.optional(v.number()),
  runnerUpKey: v.optional(v.string()),
})

/** What a persona does on one dimension since an experiment decided it (shared `StrategyDefault`). */
export const strategyDefaultValidator = v.object({
  kind: experimentKindValidator,
  key: v.string(),
  label: v.string(),
  description: v.string(),
  lengthFactor: v.optional(v.number()),
  // Never stored by a decision: a decided publish time moves formats[].publishHour instead. Here so a
  // default reads like the variant it came from.
  hourOffset: v.optional(v.number()),
  experimentId: v.optional(v.id('experiments')),
  since: v.number(),
})

/** A stored pillar weight. Read only through shared `pillarWeights`, which drops removed pillars and normalizes. */
export const pillarWeightValidator = v.object({ pillar: v.string(), weight: v.number() })

/**
 * A persona's strategy, kept by the weekly review (core/strategy.ts) and by
 * decided experiments (core/experiments.ts). Publish hours are not here: the
 * review patches `formats[].publishHour`, their one home.
 */
export const strategyValidator = v.object({
  pillarWeights: v.array(pillarWeightValidator),
  defaults: v.array(strategyDefaultValidator),
  reviewedAt: v.optional(v.number()),
})

/** One number behind a journal entry; the unit is in the label, so the value is always a plain number. */
export const journalNumberValidator = v.object({ label: v.string(), value: v.number() })

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
