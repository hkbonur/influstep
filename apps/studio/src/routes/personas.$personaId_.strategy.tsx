import { api } from '@influstep/convex/_generated/api'
import type { Doc, Id } from '@influstep/convex/_generated/dataModel'
import {
  EXPERIMENT_KINDS,
  EXPERIMENT_KIND_LABELS,
  JOURNAL_KIND_LABELS,
  METRIC_DENOMINATOR,
  METRIC_RATE_LABELS,
  PLATFORM_LABELS,
  catalogControl,
  effectiveStyle,
  pillarWeights,
  type JournalActor,
} from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { JobState, PlatformGlyphs } from '@/components/status'
import { Button, ErrorLine, LinkButton, Mono, PageHeader, Skeleton, Spinner } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { formatCount, formatDate, formatDateTime, formatHour, formatNumber, formatPercent } from '@/lib/format'
import { nextReviewAt } from '@/lib/strategy'
import { useNow } from '@/lib/use-now'

// `$personaId_`: the same /personas/:id/strategy address, outside the persona page's route, like the voice page. The
// persona page renders no outlet, so a route nested under it would show the persona page and never this one.
export const Route = createFileRoute('/personas/$personaId_/strategy')({ component: StrategyPage })

/*
 * Where the page reads from (docs/plan.md v0.2, slice 8):
 * - private.personas.get: the persona (its stored strategy, pillars, formats, timezone) and its episodes, whose
 *   titles name the journal's evidence.
 * - private.experiments.list for the persona: the running experiment with its per-variant stats and createdBy, and
 *   the names of the experiments a learning or a journal entry points at. The Experiments page shows the same rows.
 * - private.strategy.get: `learnings` (the persona's memories rows, active and superseded) and `journal` (its
 *   journal rows), which the page orders itself, newest first, `reviewJob`, the persona's newest review_strategy
 *   job (null before the first), for Review now, and `signals`, the id and title of each signal a journal entry
 *   names as evidence (a swapped concept's two signals), so the entry can name them.
 * The pillar weights and the defaults in force are never read raw: they go through shared pillarWeights and
 * effectiveStyle, the one rule for each.
 */
type PersonaData = NonNullable<FunctionReturnType<typeof api.private.personas.get>>
type StrategyData = NonNullable<FunctionReturnType<typeof api.private.strategy.get>>
type Learning = StrategyData['learnings'][number]
type JournalEntry = StrategyData['journal'][number]
type ExperimentRow = FunctionReturnType<typeof api.private.experiments.list>[number]

/** Who made a journal entry, as its meta line says it. */
const ACTOR_WORDS: Record<JournalActor, string> = {
  analyst: 'by the analyst',
  researcher: 'by the researcher',
  operator: 'by you',
}

/** The names of the persona's experiments by id, for the links of its learnings and its journal. */
type ExperimentNames = Map<Id<'experiments'>, string>

/**
 * A persona's strategy (DESIGN.md, Strategy page): what it tests now and what
 * it does by default, then the pillar weights and publish hours the planner
 * follows, then what it learned and the journal of every change, with the
 * reasons. One column, read top to bottom.
 */
function StrategyPage() {
  const params = Route.useParams()
  const personaId = params.personaId as Id<'personas'>
  const data = useQuery(api.private.personas.get, { personaId })
  const strategy = useQuery(api.private.strategy.get, { personaId })
  const experiments = useQuery(api.private.experiments.list, { personaId })
  if (data === null || strategy === null) return <p className="text-ash">This persona does not exist.</p>
  if (data === undefined || strategy === undefined || experiments === undefined) {
    return <Skeleton className="h-96" />
  }
  const persona = data.persona
  const running = experiments.find((experiment) => experiment.status === 'running')
  const names: ExperimentNames = new Map(experiments.map((experiment) => [experiment._id, experiment.name]))
  return (
    <div className="max-w-[48rem]">
      <StrategyHeader persona={persona} reviewJob={strategy.reviewJob} />
      <div className="space-y-10">
        <NowTesting persona={persona} running={running === undefined ? null : running} />
        <Defaults persona={persona} learnings={strategy.learnings} runningKind={running?.kind} />
        <Pillars persona={persona} />
        <PublishHours persona={persona} />
        <Learnings learnings={strategy.learnings} names={names} />
        <Journal entries={strategy.journal} episodes={data.episodes} signals={strategy.signals} names={names} />
      </div>
    </div>
  )
}

/**
 * Review now asks the analyst for a review out of turn. The button is never
 * disabled, so focus stays on it: while the request is out, and while the
 * review waits or runs, it is aria-busy with a spinner. A click during the
 * request is ignored, so one click queues one review; a click while a review
 * is queued reaches the backend, whose refusal says so under the header.
 */
type ReviewState =
  | { status: 'idle' }
  | { status: 'asking' }
  // The review job as it stood at the click (null before the page saw one), so the error lasts only as long as that.
  | { status: 'error'; message: string; job: JobMark | null }

/** A review job at one moment: which job, and in which status. */
type JobMark = { id: Id<'jobs'>; status: Doc<'jobs'>['status'] }

/**
 * The error to show under the header, if any. A refusal such as "already
 * reviewing" is true only while the review job stands as it did at the click;
 * once that review ends, or a review the page had not seen yet appears, the
 * Job state line says what is true and the error would contradict it.
 */
function standingError(state: ReviewState, job: Doc<'jobs'> | null): string | null {
  if (state.status !== 'error') return null
  if (state.job === null) return job === null ? state.message : null
  if (job === null) return null
  if (job._id !== state.job.id || job.status !== state.job.status) return null
  return state.message
}

function StrategyHeader(props: { persona: Doc<'personas'>; reviewJob: Doc<'jobs'> | null }) {
  const reviewNow = useMutation(api.private.strategy.reviewNow)
  const [state, setState] = React.useState<ReviewState>({ status: 'idle' })
  const now = useNow(60_000)
  const persona = props.persona
  const asking = state.status === 'asking'
  const reviewing = props.reviewJob?.status === 'queued' || props.reviewJob?.status === 'running'
  const error = standingError(state, props.reviewJob)
  const ask = async () => {
    if (asking) return
    const clicked = props.reviewJob
    setState({ status: 'asking' })
    try {
      await reviewNow({ personaId: persona._id })
      setState({ status: 'idle' })
    } catch (caught) {
      const job = clicked === null ? null : { id: clicked._id, status: clicked.status }
      setState({ status: 'error', message: errorMessage(caught), job })
    }
  }
  const reviewedAt = persona.strategy?.reviewedAt
  const last = reviewedAt === undefined ? 'Not reviewed yet.' : `Reviewed ${formatDate(reviewedAt)}.`
  // The weekly review queues only for personas that are not paused.
  const next = persona.paused
    ? `Paused: the weekly review waits until you resume ${persona.name}.`
    : `Next review ${formatDateTime(nextReviewAt(now))}.`
  return (
    <>
      <PageHeader
        title={`Strategy of ${persona.name}`}
        lead={`${last} ${next}`}
        actions={
          <>
            <Button size="sm" aria-busy={asking || reviewing} onClick={() => void ask()}>
              {(asking || reviewing) && <Spinner />}
              Review now
            </Button>
            <LinkButton to="/personas/$personaId" params={{ personaId: persona._id }} size="sm" variant="ghost">
              Open persona
            </LinkButton>
          </>
        }
      />
      {/* Mounted before the first review exists, so the job appearing is announced, and every status after it. */}
      <div aria-live="polite" className="-mt-2 mb-8 space-y-2">
        {props.reviewJob && <JobState job={props.reviewJob} />}
        {error !== null && <ErrorLine>{error}</ErrorLine>}
      </div>
    </>
  )
}

function SectionHeading(props: { children: React.ReactNode }) {
  return <h2 className="eyebrow mb-3">{props.children}</h2>
}

/**
 * The one experiment running: what it compares, on which metric, who chose
 * it, and how far each variant is from the exposures it needs before the
 * analyst can decide.
 */
function NowTesting(props: { persona: Doc<'personas'>; running: ExperimentRow | null }) {
  const running = props.running
  if (running === null) {
    // The review starts experiments only for a persona with a video platform: every dimension is a video's.
    const onVideo = props.persona.formats.some((format) => format.platform !== 'x')
    return (
      <section>
        <SectionHeading>Now testing</SectionHeading>
        <p className="text-ash">
          {onVideo
            ? 'Nothing running. The next review picks one.'
            : `Nothing running. Experiments vary videos, and ${props.persona.name} posts only on X.`}
        </p>
      </section>
    )
  }
  const denominator = METRIC_DENOMINATOR[running.metric]
  return (
    <section>
      <SectionHeading>Now testing</SectionHeading>
      <h3 className="font-semibold">{running.name}</h3>
      <p className="mt-0.5 text-xs text-ash">
        On {METRIC_RATE_LABELS[running.metric]} · {running.createdBy === 'operator' ? 'set up by you' : `picked by ${props.persona.name}`} ·{' '}
        <Link to="/experiments" className="underline decoration-fog hover:text-ink hover:decoration-ink">
          Experiments
        </Link>
      </p>
      <ul className="mt-3 space-y-3">
        {running.variants.map((variant) => {
          // The backend counts every variant of the experiment, measured or not, so a missing row is a bug.
          const stats = running.stats.find((stat) => stat.key === variant.key)
          if (!stats) throw new Error(`experiment ${running._id} has no stats for its variant "${variant.key}"`)
          const exposures = stats.exposures
          const share = Math.min(1, exposures / running.minExposures)
          return (
            <li key={variant.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span>
                  {variant.label}
                  {variant.isControl && <span className="ml-1.5 text-xs text-ash">control</span>}
                </span>
                <span className="tabular font-mono text-[11px] text-ash">
                  {exposures < running.minExposures
                    ? `${formatCount(exposures)} of ${formatCount(running.minExposures)} ${denominator}`
                    : `${formatCount(exposures)} ${denominator}, enough`}
                </span>
              </div>
              <p className="text-xs text-ash">{variant.description}</p>
              {/* The numbers beside it say the same, so the line is hidden from screen readers. */}
              <div aria-hidden className="mt-1 h-1 overflow-hidden rounded-full bg-mist">
                <div className="h-full rounded-full bg-graphite" style={{ width: `${share * 100}%` }} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * What every episode does on each dimension unless its experiment varies it:
 * the persona's default from a decided experiment, or the catalog's control,
 * "as before". A default names the day it took over and the learning behind it.
 * Publish time is the exception: a decided test moves the publish hours instead
 * of storing a default, so its row always reads the usual hour and points at
 * the hours.
 */
function Defaults(props: { persona: Doc<'personas'>; learnings: Learning[]; runningKind: ExperimentRow['kind'] | undefined }) {
  const stored = props.persona.strategy?.defaults
  const style = effectiveStyle({}, stored)
  return (
    <section>
      <SectionHeading>Defaults</SectionHeading>
      <dl className="divide-y divide-mist border-y border-mist">
        {EXPERIMENT_KINDS.map((kind) => {
          const testedNow = props.runningKind === kind
          if (kind === 'publish_time') {
            return (
              <DefaultRow
                key={kind}
                label={EXPERIMENT_KIND_LABELS[kind]}
                value={`${catalogControl(kind).label} (as before)`}
                testedNow={testedNow}
              >
                Decided tests move the hours below.
              </DefaultRow>
            )
          }
          const variant = style[kind]
          const decided = stored?.find((entry) => entry.kind === kind)
          const learning =
            decided?.experimentId === undefined
              ? undefined
              : props.learnings.find((entry) => entry.status === 'active' && entry.evidence.experimentId === decided.experimentId)
          return (
            <DefaultRow
              key={kind}
              label={EXPERIMENT_KIND_LABELS[kind]}
              value={variant.isControl ? `${variant.label} (as before)` : variant.label}
              since={decided?.since}
              testedNow={testedNow}
            >
              {learning?.text}
            </DefaultRow>
          )
        })}
      </dl>
    </section>
  )
}

/** One dimension's row: its label, the variant in force with when it took over, and an ash line under it. */
function DefaultRow(props: { label: string; value: string; since?: number; testedNow: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-0.5 py-2.5 sm:grid-cols-[10rem_1fr]">
      <dt className="text-xs text-graphite sm:pt-0.5">{props.label}</dt>
      <dd className="min-w-0">
        <p>
          {props.value}
          {props.since !== undefined && <span className="text-xs text-ash"> · since {formatDate(props.since)}</span>}
          {props.testedNow && <span className="text-xs text-ash"> · being tested now</span>}
        </p>
        {props.children !== undefined && <p className="text-xs text-ash">{props.children}</p>}
      </dd>
    </div>
  )
}

/** How the planner shares the evergreen slots between the pillars, in the persona's pillar order. */
function Pillars(props: { persona: Doc<'personas'> }) {
  const weights = pillarWeights(props.persona.pillars, props.persona.strategy?.pillarWeights)
  return (
    <section>
      <SectionHeading>Pillars</SectionHeading>
      <ul className="space-y-2">
        {weights.map((entry) => (
          <li key={entry.pillar} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-4 sm:grid-cols-[14rem_1fr_3rem]">
            <span className="truncate">{entry.pillar}</span>
            {/* The percentage beside it says the same, so the bar is hidden from screen readers. */}
            <span aria-hidden className="order-last col-span-2 h-1 overflow-hidden rounded-full bg-mist sm:order-none sm:col-span-1">
              <span className="block h-full rounded-full bg-graphite" style={{ width: `${entry.weight * 100}%` }} />
            </span>
            <span className="tabular text-right font-mono text-[11px] text-ash">{formatPercent(entry.weight, 0)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ash">Reactive episodes follow the signals; the rest of the week is shared out by these weights.</p>
    </section>
  )
}

/** The hour each video platform publishes at. X posts follow their own slots, which the review leaves alone. */
function PublishHours(props: { persona: Doc<'personas'> }) {
  const formats = props.persona.formats.filter((format) => format.platform !== 'x')
  const onX = props.persona.formats.some((format) => format.platform === 'x')
  return (
    <section>
      <SectionHeading>Publish hours</SectionHeading>
      {formats.length > 0 && (
        <ul className="space-y-1.5">
          {formats.map((format) => (
            <li key={format.platform} className="flex items-baseline gap-2">
              {/* The platform's name follows, so the glyph is not read as well. */}
              <span aria-hidden>
                <PlatformGlyphs platforms={[format.platform]} />
              </span>
              <span className="w-24">{PLATFORM_LABELS[format.platform]}</span>
              <Mono>{formatHour(format.publishHour)}</Mono>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-ash">
        {formats.length > 0 && `In ${props.persona.timezone} time. `}
        {onX && 'X posts keep their own slots; the review does not move them.'}
      </p>
    </section>
  )
}

/**
 * What the persona learned from its decided experiments, which the writer
 * reads before every script. A newer learning on the same dimension supersedes
 * an older one, which stays under Earlier, so the persona can show why it
 * changed its mind.
 */
function Learnings(props: { learnings: Learning[]; names: ExperimentNames }) {
  const newestFirst = [...props.learnings].sort((a, b) => b.createdAt - a.createdAt)
  const active = newestFirst.filter((learning) => learning.status === 'active')
  const earlier = newestFirst.filter((learning) => learning.status === 'superseded')
  return (
    <section>
      <SectionHeading>Learnings</SectionHeading>
      {active.length === 0 && <p className="text-ash">Nothing learned yet. Each decided experiment leaves one.</p>}
      {active.length > 0 && (
        <ul className="space-y-3">
          {active.map((learning) => (
            <LearningRow key={learning._id} learning={learning} names={props.names} />
          ))}
        </ul>
      )}
      {earlier.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-ash hover:text-ink">
            Earlier <span className="tabular">({earlier.length})</span>
          </summary>
          <ul className="mt-3 space-y-3">
            {earlier.map((learning) => (
              <LearningRow key={learning._id} learning={learning} names={props.names} />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function LearningRow(props: { learning: Learning; names: ExperimentNames }) {
  const learning = props.learning
  return (
    <li>
      <p>{learning.text}</p>
      <p className="mt-0.5 text-[11px] text-ash">
        {formatDate(learning.createdAt)}
        {learning.evidence.experimentId !== undefined && (
          <ExperimentLink experimentId={learning.evidence.experimentId} names={props.names} />
        )}
      </p>
    </li>
  )
}

/** An experiment named as evidence, linking the Experiments page, which has no page per experiment. */
function ExperimentLink(props: { experimentId: Id<'experiments'>; names: ExperimentNames }) {
  const name = props.names.get(props.experimentId)
  if (name === undefined) return null
  return (
    <>
      {' · '}
      <Link to="/experiments" className="underline decoration-fog hover:text-ink hover:decoration-ink">
        {name}
      </Link>
    </>
  )
}

/**
 * Every change to the strategy, newest first: what changed, why, with the
 * numbers and the evidence it rests on, and who made it. Last on the page: it
 * explains the sections above it.
 */
function Journal(props: {
  entries: JournalEntry[]
  episodes: PersonaData['episodes']
  signals: StrategyData['signals']
  names: ExperimentNames
}) {
  const newestFirst = [...props.entries].sort((a, b) => b.createdAt - a.createdAt)
  const titles = new Map(props.episodes.map((episode) => [episode._id, episode.title]))
  const signalTitles = new Map(props.signals.map((signal) => [signal._id, signal.title]))
  return (
    <section>
      <SectionHeading>Journal</SectionHeading>
      {newestFirst.length === 0 && <p className="text-ash">No changes yet. Each change a review makes is written here with its reason.</p>}
      {newestFirst.length > 0 && (
        <ol className="divide-y divide-mist border-y border-mist">
          {newestFirst.map((entry) => (
            <li key={entry._id} className="py-3">
              <p className="text-[11px] text-ash">
                <span className="tabular font-mono">{formatDate(entry.createdAt)}</span> · {JOURNAL_KIND_LABELS[entry.kind]} ·{' '}
                {ACTOR_WORDS[entry.actor]}
              </p>
              <p className="mt-0.5">{entry.text}</p>
              <p className="mt-0.5 text-xs text-ash">{entry.reason}</p>
              {entry.evidence.numbers.length > 0 && (
                <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
                  {entry.evidence.numbers.map((number) => (
                    <div key={number.label} className="flex gap-1.5">
                      <dt className="text-ash">{number.label}</dt>
                      <dd className="tabular font-mono text-graphite">{formatNumber(number.value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <EvidenceLinks entry={entry} titles={titles} signalTitles={signalTitles} names={props.names} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * The experiment, the episodes and the signals a journal entry rests on, as
 * links. An episode or a signal no longer listed shows nothing. A signal links
 * the Signals page, filtered to the persona, which has no page per signal.
 */
function EvidenceLinks(props: {
  entry: JournalEntry
  titles: Map<Id<'episodes'>, string>
  signalTitles: Map<Id<'signals'>, string>
  names: ExperimentNames
}) {
  const experimentId = props.entry.evidence.experimentId
  const experimentName = experimentId === undefined ? undefined : props.names.get(experimentId)
  const episodes = props.entry.evidence.episodeIds.flatMap((episodeId) => {
    const title = props.titles.get(episodeId)
    return title === undefined ? [] : [{ episodeId, title }]
  })
  const signals = props.entry.evidence.signalIds.flatMap((signalId) => {
    const title = props.signalTitles.get(signalId)
    return title === undefined ? [] : [{ signalId, title }]
  })
  if (experimentName === undefined && episodes.length === 0 && signals.length === 0) return null
  return (
    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ash">
      <span>Evidence</span>
      {experimentName !== undefined && (
        <Link to="/experiments" className="underline decoration-fog hover:text-ink hover:decoration-ink">
          {experimentName}
        </Link>
      )}
      {episodes.map((episode) => (
        <Link
          key={episode.episodeId}
          to="/episodes/$episodeId"
          params={{ episodeId: episode.episodeId }}
          className="underline decoration-fog hover:text-ink hover:decoration-ink"
        >
          {episode.title}
        </Link>
      ))}
      {signals.map((signal) => (
        <Link
          key={signal.signalId}
          to="/signals"
          search={{ persona: props.entry.personaId }}
          className="underline decoration-fog hover:text-ink hover:decoration-ink"
        >
          {signal.title}
        </Link>
      ))}
    </p>
  )
}
