import { api } from '@influstep/convex/_generated/api'
import type { Doc, Id } from '@influstep/convex/_generated/dataModel'
import {
  APPEARANCE_STYLES,
  APPEARANCE_STYLE_LABELS,
  DELIVERY_LABELS,
  PRESENTER_FACES,
  PRESENTER_FACE_LABELS,
  EPISODE_KIND_LABELS,
  SPONSOR_SEGMENT_LABELS,
  bioPath,
  formatLength,
  isPost,
  type AppearanceStyle,
  type PresenterFace,
  type MemoryKind,
  type PersonaColor,
  type PlatformFormat,
  type Voice,
} from '@influstep/shared'
import { CaretRightIcon } from '@phosphor-icons/react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { FormatFields } from '@/components/format-fields'
import { PersonaColorSwatches, PersonaMascot, personaAvatarState } from '@/components/persona-avatar'
import { PersonaChat } from '@/components/persona-chat'
import { JobDot, PlatformGlyphs, PostKindIcon, StatusPill } from '@/components/status'
import {
  Button,
  CheckboxField,
  ErrorLine,
  Eyebrow,
  ExternalLinkButton,
  Field,
  type FormState,
  Input,
  LinkButton,
  MockNote,
  Mono,
  PageHeader,
  Pill,
  Skeleton,
  Textarea,
} from '@/components/ui'
import { assetCounts } from '@/lib/assets'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatCount, formatDate, formatDay, formatHour, formatMoney, languageName, plural, relativeTime, todayKey } from '@/lib/format'
import { ideaLine } from '@/lib/ideas'
import { PROBLEMS_SHOWN, briefTime, splitBrief } from '@/lib/research'
import { useNow } from '@/lib/use-now'

export const Route = createFileRoute('/personas/$personaId')({ component: PersonaPage })

type PersonaData = NonNullable<FunctionReturnType<typeof api.private.personas.get>>

type HeaderActionKey = 'plan' | 'metrics' | 'pause'

/**
 * The persona's own numbers in its header, over the report's window: what it
 * earned, the paid conversions behind that, and its views, linked to its
 * report, so the operator does not have to open it to see if the persona works.
 */
function PersonaNumbers(props: { personaId: Id<'personas'>; numbers: PersonaData['numbers']; refresh: React.ReactNode }) {
  const { numbers } = props
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2">
      <Link to="/reports/$personaId" params={{ personaId: props.personaId }} className="group w-fit">
        <span className="tabular font-medium text-ink">{formatMoney(numbers.value, numbers.currency)}</span>
        <span className="text-ash"> earned from </span>
        <span className="tabular text-graphite">{numbers.paid}</span>
        <span className="text-ash"> paid · </span>
        <span className="tabular text-graphite">{formatCount(numbers.views)}</span>
        <span className="text-ash group-hover:underline">
          {' '}
          views, last {numbers.days} days{numbers.mock ? ' (mock)' : ''}
        </span>
      </Link>
      {props.refresh}
    </span>
  )
}

type QueuedAction<Key extends string> =
  | { status: 'idle' }
  | { status: 'busy'; key: Key }
  | { status: 'done'; message: string }
  | { status: 'error'; message: string }

/** One queued request at a time: busy while it is out, then what it queued or why it was refused. */
function useQueuedAction<Key extends string>() {
  const [state, setState] = React.useState<QueuedAction<Key>>({ status: 'idle' })
  const run = async (key: Key, request: () => Promise<unknown>, done: string) => {
    if (state.status === 'busy') return
    setState({ status: 'busy', key })
    try {
      await request()
      setState({ status: 'done', message: done })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const busy = (key: Key) => state.status === 'busy' && state.key === key
  return { state, run, busy }
}

/** Stays mounted, so what an action queued, or why it was refused, is heard where the operator's focus already is. */
function QueuedLine(props: { state: QueuedAction<string>; className?: string }) {
  return (
    <div aria-live="polite" className={cn('text-xs', props.className)}>
      {props.state.status === 'done' && <p className="text-ash">{props.state.message}</p>}
      {props.state.status === 'error' && <ErrorLine>{props.state.message}</ErrorLine>}
    </div>
  )
}

/** Past the day and done with: measured, published or killed. Everything else is still ahead of the operator. */
function isEarlier(episode: PersonaData['episodes'][number], today: string): boolean {
  if (episode.plannedFor >= today) return false
  return episode.status === 'measured' || episode.status === 'published' || episode.status === 'killed'
}

function PersonaPage() {
  const params = Route.useParams()
  const personaId = params.personaId as Id<'personas'>
  const data = useQuery(api.private.personas.get, { personaId })
  const setPaused = useMutation(api.private.personas.setPaused)
  const planWeek = useMutation(api.private.personas.planWeek)
  const pullMetrics = useMutation(api.private.personas.pullMetrics)
  const retireDiscountCode = useMutation(api.private.personas.retireDiscountCode)
  const [settings, setSettings] = React.useState(false)
  const { state: action, run, busy } = useQueuedAction<HeaderActionKey>()
  const today = todayKey()

  if (data === undefined) return <Skeleton className="h-96" />
  if (data === null) return <p className="text-ash">This persona does not exist.</p>
  const { persona } = data
  const providersMock =
    data.jobs.some((job) => job.kind === 'pull_metrics') && data.episodes.some((episode) => episode.renders.some((render) => render.mock))
  // Soonest first, so the next thing to go out leads; the past stays folded under it.
  const upcoming = data.episodes.filter((episode) => !isEarlier(episode, today)).sort((a, b) => a.plannedFor.localeCompare(b.plannedFor))
  const earlier = data.episodes.filter((episode) => isEarlier(episode, today))
  const failedJobs = data.jobs.filter((job) => job.status === 'failed').length

  return (
    <>
      <div className="flex items-start gap-4">
        <PersonaMascot
          color={persona.color}
          state={personaAvatarState({ working: data.working, paused: persona.paused })}
          size={48}
          // Fog, as in the sidebar: a paused persona reads as switched off on every screen.
          className={cn({ 'text-fog': persona.paused })}
        />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={persona.name}
            lead={
              <>
                <Mono>@{persona.handle}</Mono> · {persona.niche}
                {persona.paused && (
                  <>
                    {' '}
                    <Pill tint="alert-amber">Paused</Pill>
                  </>
                )}
                <PersonaNumbers
                  personaId={personaId}
                  numbers={data.numbers}
                  refresh={
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-ash hover:text-ink"
                      busy={busy('metrics')}
                      onClick={() =>
                        run('metrics', () => pullMetrics({ personaId }), 'Queued for the analyst: the numbers refresh shortly.')
                      }
                    >
                      Refresh
                    </Button>
                  }
                />
              </>
            }
            actions={
              <>
                <Button
                  size="sm"
                  busy={busy('plan')}
                  onClick={() =>
                    run('plan', () => planWeek({ personaId }), "Queued for the writer: this week's plan shows on the calendar.")
                  }
                >
                  Plan this week
                </Button>
                <LinkButton to="/reports/$personaId" params={{ personaId }} size="sm">
                  Report
                </LinkButton>
                <Button size="sm" variant="ghost" onClick={() => setSettings((value) => !value)}>
                  {settings ? 'Close settings' : 'Settings'}
                </Button>
                <Button
                  size="sm"
                  variant={persona.paused ? 'primary' : 'destructive'}
                  busy={busy('pause')}
                  onClick={() =>
                    run(
                      'pause',
                      () => setPaused({ personaId, paused: !persona.paused }),
                      persona.paused ? `${persona.name} is working again.` : `${persona.name} is paused: nothing runs until you resume.`
                    )
                  }
                >
                  {persona.paused ? 'Resume' : 'Pause'}
                </Button>
              </>
            }
          />
          <QueuedLine state={action} className="-mt-4 mb-4" />
        </div>
      </div>
      {settings && <SettingsForm persona={persona} onDone={() => setSettings(false)} />}

      <div className="grid gap-8 xl:grid-cols-[1fr_1.4fr_0.8fr] xl:gap-8">
        <div className="flex max-h-[70vh] min-h-[28rem] flex-col">
          <Eyebrow className="mb-3">Chat</Eyebrow>
          <PersonaChat persona={persona} messages={data.messages} directives={data.directives} episodes={data.episodes} jobs={data.jobs} />
        </div>

        <div>
          <Eyebrow className="mb-3">Coming up</Eyebrow>
          {data.episodes.length === 0 && <p className="text-ash">No episodes yet. Plan the week to get {persona.episodesPerWeek}.</p>}
          {data.episodes.length > 0 && upcoming.length === 0 && <p className="text-ash">Nothing planned ahead. Plan this week.</p>}
          {upcoming.length > 0 && <EpisodeList episodes={upcoming} />}
          {earlier.length > 0 && (
            <details className="group mt-4">
              <summary className="eyebrow w-fit cursor-pointer hover:text-graphite">
                Earlier <span className="tabular">({earlier.length})</span>
              </summary>
              <div className="mt-3">
                <EpisodeList episodes={earlier} />
              </div>
            </details>
          )}
          <MockNote when={providersMock} />
        </div>

        <div className="space-y-8">
          <section>
            <Eyebrow className="mb-3">Waits on you</Eyebrow>
            {data.checklist.length === 0 && <p className="text-xs text-ash">Nothing. {persona.name} is working on its own.</p>}
            <ul className="space-y-4">
              {data.checklist.map((item) => (
                <ChecklistRow
                  key={item._id}
                  item={item}
                  episodeTitle={data.episodes.find((episode) => episode._id === item.episodeId)?.title ?? null}
                />
              ))}
            </ul>
          </section>

          <PersonaPages persona={persona} replies={data.replies} />

          <ResearchSummary personaId={personaId} />

          <details className="group">
            <summary className="eyebrow w-fit cursor-pointer hover:text-graphite">Profile</summary>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              {persona.audience && (
                <>
                  <dt className="text-ash">Audience</dt>
                  <dd>{persona.audience}</dd>
                </>
              )}
              <dt className="text-ash">Cadence</dt>
              <dd className="tabular">
                {persona.episodesPerWeek} a week, {persona.timezone}
              </dd>
              <dt className="text-ash">Formats</dt>
              {/* One grid for every format: glyph, length over delivery, hour, so the narrow column never breaks a row mid-phrase. */}
              <dd className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1.5">
                {persona.formats.map((format) => (
                  <React.Fragment key={format.platform}>
                    <PlatformGlyphs platforms={[format.platform]} />
                    <span>
                      <span className="tabular">{formatLength(format.lengthSec)}</span>
                      <span className="block text-ash">{DELIVERY_LABELS[format.delivery]}</span>
                    </span>
                    <Mono className="text-ash">{formatHour(format.publishHour)}</Mono>
                    {format.cadence && (
                      <span className="col-start-2 col-end-4 text-ash">
                        <span className="tabular">{format.cadence.postsPerDay}</span> {format.cadence.postsPerDay === 1 ? 'post' : 'posts'}{' '}
                        a day: {format.cadence.kinds.map((kind) => EPISODE_KIND_LABELS[kind].toLowerCase()).join(', ')}
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </dd>
              <dt className="text-ash">Look</dt>
              <dd>
                <LookLine personaId={personaId} look={data.look} />
              </dd>
              <dt className="text-ash">Speaks with</dt>
              <dd>
                <SpokenVoiceLine persona={persona} voiceJob={data.voiceJob} />
              </dd>
              <dt className="text-ash">Sponsor dial</dt>
              <dd className="tabular">
                {Math.round(persona.sponsorDial * 100)}% after {persona.sponsorRampEpisodes} episodes
              </dd>
              <dt className="text-ash">Pillars</dt>
              <dd>{persona.pillars.join(', ')}</dd>
              <dt className="text-ash">Approval</dt>
              <dd>{persona.autoApprove ? 'Automatic' : 'You approve each script'}</dd>
              <dt className="text-ash">Publishing</dt>
              <dd>{persona.autoPublish ? 'Publishes on its own' : 'You approve each package'}</dd>
              <dt className="text-ash">Discount codes</dt>
              <dd className="space-y-1">
                {data.discountCodes.length === 0 && (
                  <span>
                    None yet.{' '}
                    <button type="button" className="text-ash hover:text-ink" onClick={() => setSettings(true)}>
                      Give a code
                    </button>
                  </span>
                )}
                {data.discountCodes.map((discountCode) => (
                  <div key={discountCode._id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <Mono>{discountCode.code}</Mono>
                    <span>{discountCode.offer}</span>
                    <span className="tabular text-ash">{discountCode.redemptions} redemptions</span>
                    {discountCode.episodeTitle && <span className="text-ash">for {discountCode.episodeTitle}</span>}
                    <button
                      type="button"
                      className="text-ash hover:text-ink"
                      onClick={() => retireDiscountCode({ discountCodeId: discountCode._id })}
                    >
                      Retire
                    </button>
                  </div>
                ))}
              </dd>
              {data.bioLink && (
                <>
                  <dt className="text-ash">Link in bio</dt>
                  {/* One address per platform, each naming its platform, so the report counts a bio's clicks where they came from. */}
                  <dd>
                    <ul className="space-y-1">
                      {persona.formats.map((format) => (
                        <li key={format.platform} className="flex items-baseline gap-2">
                          <PlatformGlyphs platforms={[format.platform]} />
                          <Mono className="break-all">
                            {data.appUrl}
                            {bioPath(persona.handle, format.platform)}
                          </Mono>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-ash">
                      Put each in that platform's bio. {data.bioLink.clicks} clicks on /go/{data.bioLink.slug}
                    </p>
                  </dd>
                </>
              )}
            </dl>
          </details>

          {data.jobs.length > 0 && (
            <details className="group">
              <summary className="eyebrow w-fit cursor-pointer hover:text-graphite">
                Recent jobs
                {/* A failure is the one thing in here worth opening for, so it shows on the closed summary. */}
                {failedJobs > 0 && <span className="ml-2 text-signal-red-deep normal-case tracking-normal">{failedJobs} failed</span>}
              </summary>
              <ul className="mt-3 space-y-1 font-mono text-[11px]">
                {data.jobs.map((job) => (
                  <li key={job._id} className="flex items-center gap-2">
                    <JobDot status={job.status} />
                    <span className="text-graphite">{job.kind}</span>
                    <span className="text-ash">{job.role}</span>
                    <span className="ml-auto text-ash">{relativeTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </>
  )
}

/** A persona's episodes as rows: day, title, its first line (or when the writer gets to it), and its status. */
function EpisodeList(props: { episodes: PersonaData['episodes'] }) {
  return (
    <ol className="divide-y divide-mist border-y border-mist">
      {props.episodes.map((episode) => (
        <li key={episode._id} className={cn('flex items-start gap-3 py-2.5', { 'opacity-60': episode.status === 'killed' })}>
          <span className="tabular w-14 shrink-0 pt-0.5 font-mono text-xs text-ash">
            {formatDay(episode.plannedFor, { month: 'short', day: 'numeric' })}
          </span>
          <div className="min-w-0 flex-1">
            <Link
              to="/episodes/$episodeId"
              params={{ episodeId: episode._id }}
              className="flex items-center gap-1.5 font-medium hover:underline"
            >
              {isPost(episode.kind) && <PostKindIcon kind={episode.kind} className="shrink-0 text-graphite" />}
              <span className="line-clamp-1">{episode.title}</span>
            </Link>
            <p className="line-clamp-1 text-xs text-ash">
              {episode.status === 'idea' ? ideaLine(episode, episode.writing) : episode.hook || episode.concept}
              {episode.sponsorSegment !== 'none' && <> · {SPONSOR_SEGMENT_LABELS[episode.sponsorSegment]}</>}
            </p>
            {episode.error && <p className="mt-0.5 line-clamp-1 font-mono text-[11px] text-signal-red-deep">{episode.error}</p>}
          </div>
          <StatusPill status={episode.status} />
        </li>
      ))}
    </ol>
  )
}

/**
 * The persona's own pages as one list, each with the one line that says
 * whether it is worth opening now: what waits in the replies, what is being
 * tested, what the persona keeps, what its library holds, and its X voice.
 */
function PersonaPages(props: { persona: Doc<'personas'>; replies: PersonaData['replies'] }) {
  const personaId = props.persona._id
  const onX = props.persona.formats.some((format) => format.platform === 'x')
  return (
    <nav aria-label={`${props.persona.name}'s pages`}>
      <ul className="divide-y divide-mist border-y border-mist text-sm">
        {props.replies && (
          <PageRow to="/personas/$personaId/replies" personaId={personaId} label="Replies">
            <RepliesLine replies={props.replies} />
          </PageRow>
        )}
        <PageRow to="/personas/$personaId/strategy" personaId={personaId} label="Strategy">
          <StrategyLine persona={props.persona} />
        </PageRow>
        <PageRow to="/personas/$personaId/memory" personaId={personaId} label="Memory">
          <MemoryLine personaId={personaId} />
        </PageRow>
        <PageRow to="/personas/$personaId/assets" personaId={personaId} label="Assets">
          <AssetsLine personaId={personaId} />
        </PageRow>
        {onX && (
          <PageRow to="/personas/$personaId/voice" personaId={personaId} label="Voice on X">
            {props.persona.voice ? voiceSummary(props.persona.voice) : <span className="text-alert-amber-deep">Not learned yet</span>}
          </PageRow>
        )}
      </ul>
    </nav>
  )
}

function PageRow(props: {
  to:
    | '/personas/$personaId/replies'
    | '/personas/$personaId/strategy'
    | '/personas/$personaId/memory'
    | '/personas/$personaId/assets'
    | '/personas/$personaId/voice'
  personaId: Id<'personas'>
  label: string
  children: React.ReactNode
}) {
  return (
    <li>
      <Link to={props.to} params={{ personaId: props.personaId }} className="group flex items-baseline gap-3 py-2">
        <span className="w-20 shrink-0 font-medium group-hover:underline">{props.label}</span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-ash">{props.children}</span>
        <CaretRightIcon aria-hidden size={12} className="shrink-0 self-center text-smoke group-hover:text-ink" />
      </Link>
    </li>
  )
}

/** What waits for the operator, in amber like every other count that waits on them, and today's budget. */
function RepliesLine(props: { replies: NonNullable<PersonaData['replies']> }) {
  const replies = props.replies
  if (replies.budget === 0) return <>Off: the budget is 0</>
  return (
    <>
      {replies.waiting > 0 && <span className="tabular text-alert-amber-deep">{replies.waiting} waiting · </span>}
      {replies.goingOut > 0 && <span className="tabular">{replies.goingOut} going out · </span>}
      <span className="tabular">
        {replies.sentToday} of {replies.budget} sent today
      </span>
    </>
  )
}

/** What the persona tests now; when it was last reviewed is on hover, the strategy page says it in full. */
function StrategyLine(props: { persona: Doc<'personas'> }) {
  const experiments = useQuery(api.private.experiments.list, { personaId: props.persona._id })
  // The strategy review keeps one experiment running per persona, so the first running one is the one.
  const running = experiments?.find((experiment) => experiment.status === 'running')
  const reviewedAt = props.persona.strategy?.reviewedAt
  if (experiments === undefined) return <Skeleton className="ml-auto h-3 w-32" />
  return (
    <span title={reviewedAt === undefined ? 'Not reviewed yet' : `Reviewed ${formatDate(reviewedAt)}`}>
      {running ? `Testing ${running.name}` : 'Nothing being tested'}
    </span>
  )
}

/** How many rules, facts and learnings the persona holds. */
function MemoryLine(props: { personaId: Id<'personas'> }) {
  const memory = useQuery(api.private.memory.list, { personaId: props.personaId })
  if (memory === undefined) return <Skeleton className="ml-auto h-3 w-32" />
  if (memory === null) return null
  const active = memory.entries.filter((entry) => entry.status === 'active')
  const count = (kind: MemoryKind, one: string, other: string) => {
    const n = active.filter((entry) => entry.kind === kind).length
    return n === 0 ? [] : [`${n} ${plural(n, one, other)}`]
  }
  const counts = [...count('rule', 'rule', 'rules'), ...count('fact', 'fact', 'facts'), ...count('learning', 'learning', 'learnings')]
  return <>{counts.length === 0 ? 'Nothing kept yet' : counts.join(', ')}</>
}

/** The asset library counted by kind. */
function AssetsLine(props: { personaId: Id<'personas'> }) {
  const library = useQuery(api.private.assets.list, { personaId: props.personaId })
  if (library === undefined) return <Skeleton className="ml-auto h-3 w-32" />
  if (library === null) return null
  return <>{library.assets.length === 0 ? 'Upload what the writer can show' : assetCounts(library.assets)}</>
}

type Research = FunctionReturnType<typeof api.private.research.get>

/** A brief's expiry only matters to the minute, so the section reads the clock once a minute. */
const RESEARCH_CLOCK_MS = 60_000

/**
 * What the researcher found this morning and the problems the persona keeps
 * meeting, in the Strategy summary's type (DESIGN.md, Persona page). Short on
 * purpose: three lines of the brief and three problems, the rest folded away.
 */
function ResearchSummary(props: { personaId: Id<'personas'> }) {
  const research = useQuery(api.private.research.get, { personaId: props.personaId })
  const pollSignals = useMutation(api.private.personas.pollSignals)
  const { state, run, busy } = useQueuedAction<'poll'>()
  const now = useNow(RESEARCH_CLOCK_MS)
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Eyebrow>Research</Eyebrow>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-ash hover:text-ink"
          busy={busy('poll')}
          onClick={() => run('poll', () => pollSignals({ personaId: props.personaId }), 'Queued for the researcher: new signals shortly.')}
        >
          Poll signals
        </Button>
      </div>
      <QueuedLine state={state} className="mb-2" />
      {research === undefined && <Skeleton className="h-4 w-40" />}
      {research !== undefined && (
        <div className="space-y-3 text-xs">
          <MorningBrief brief={research.brief} now={now} />
          <ProblemLog problems={research.problems} />
        </div>
      )}
    </section>
  )
}

/**
 * The newest brief, unless it expired: an expired brief says nothing about
 * today, and the writer skips it too. Judged against the page's clock, since
 * the query does not re-run when a brief runs out.
 */
function MorningBrief(props: { brief: Research['brief']; now: number }) {
  const brief = props.brief
  if (brief === null || brief.expiresAt <= props.now)
    return <p className="text-ash">No brief yet. The researcher writes one every morning.</p>
  const lines = splitBrief(brief.text)
  return (
    <div className="space-y-0.5">
      <p className="text-ash">Morning brief, {briefTime(brief.createdAt, props.now)}</p>
      {lines.head.map((line, index) => (
        // The brief's lines never move, so their place keys them; a line can repeat.
        <p key={`${index}:${line}`}>{line}</p>
      ))}
      {lines.rest.length > 0 && (
        <details>
          <summary className="cursor-pointer text-ash hover:text-ink">Whole brief</summary>
          <div className="mt-0.5 space-y-0.5">
            {lines.rest.map((line, index) => (
              <p key={`${index}:${line}`}>{line}</p>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

/** The open problems, newest first. With none, the part is left out, heading and all. */
function ProblemLog(props: { problems: Research['problems'] }) {
  if (props.problems.length === 0) return null
  const shown = props.problems.slice(0, PROBLEMS_SHOWN)
  const more = props.problems.length - shown.length
  return (
    <div className="space-y-0.5">
      <p className="text-ash">Problem log</p>
      <ul className="space-y-0.5">
        {shown.map((problem) => (
          <li key={problem._id}>{problem.text}</li>
        ))}
      </ul>
      {more > 0 && (
        <p className="text-ash">
          and <span className="tabular">{more}</span> more
        </p>
      )}
    </div>
  )
}

/** The voice row: how many posts the analyst read and the language it writes in. */
function voiceSummary(voice: Voice): string {
  const name = languageName(voice.language)
  // A tag the browser cannot name still says which language it is, so it shows as written.
  const language = name === null ? voice.language : name
  return `Learned from ${voice.sampleSize} posts, ${language}`
}

function ChecklistRow(props: {
  item: Pick<Doc<'checklistItems'>, '_id' | 'title' | 'why' | 'action' | 'createdAt'>
  episodeTitle: string | null
}) {
  const complete = useMutation(api.private.checklist.complete)
  const runAction = useMutation(api.private.checklist.runAction)
  const [error, setError] = React.useState<string | null>(null)
  const act = async () => {
    setError(null)
    try {
      await runAction({ itemId: props.item._id })
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }
  return (
    <li className="flex items-start gap-2.5">
      <input
        type="checkbox"
        className="mt-1 size-3.5 accent-ink"
        aria-label={`Done: ${props.item.title}`}
        onChange={() => complete({ itemId: props.item._id })}
      />
      <div className="min-w-0 flex-1">
        <p className="leading-snug font-medium">{props.item.title}</p>
        {/* Two lines are enough to know what to do; the Checklist page has the rest. */}
        <p className="mt-0.5 line-clamp-2 text-xs text-ash" title={props.item.why}>
          {props.item.why}
        </p>
        {props.episodeTitle && <p className="mt-0.5 truncate text-[11px] text-ash">Unblocks {props.episodeTitle}</p>}
        {props.item.action && (
          <div className="mt-2 flex gap-2">
            {props.item.action.kind === 'open_browser' && (
              <Button size="sm" onClick={act}>
                Open browser
              </Button>
            )}
            {props.item.action.kind === 'set_provider_key' && (
              <LinkButton to="/providers" size="sm">
                Set {props.item.action.key}
              </LinkButton>
            )}
            {/* A page the operator reads and acts on by hand; the runner never opens it. */}
            {props.item.action.kind === 'visit' && (
              <ExternalLinkButton href={props.item.action.url} size="sm">
                Open
              </ExternalLinkButton>
            )}
          </div>
        )}
        {error && <ErrorLine>{error}</ErrorLine>}
      </div>
    </li>
  )
}

type PersonaPage = NonNullable<FunctionReturnType<typeof api.private.personas.get>>

/** The look in one line: its style, and its references linked to the asset library. */
function LookLine(props: { personaId: Id<'personas'>; look: PersonaPage['look'] }) {
  if (props.look === null) return <span className="text-ash">Not set. Pick one in the settings.</span>
  const count = props.look.references.length
  return (
    <>
      {APPEARANCE_STYLE_LABELS[props.look.style]}
      {props.look.style === 'loom' && props.look.face && `, ${PRESENTER_FACE_LABELS[props.look.face].toLowerCase()}`}
      {props.look.style !== 'voice_only' && (
        <>
          {' · '}
          <Link to="/personas/$personaId/assets" params={{ personaId: props.personaId }} className="hover:underline">
            {count === 0 ? 'no reference yet' : `${count} ${plural(count, 'reference', 'references')}`}
          </Link>
        </>
      )}
    </>
  )
}

/** The spoken voice: its id, or where the voice provider stands in making it from the operator's words. */
function SpokenVoiceLine(props: { persona: Doc<'personas'>; voiceJob: PersonaPage['voiceJob'] }) {
  if (props.persona.voiceId !== undefined) return <Mono>{props.persona.voiceId}</Mono>
  if (props.voiceJob?.status === 'failed')
    return (
      <span>
        <span className="text-signal-red-deep">Making the voice failed: {props.voiceJob.error}</span>{' '}
        <span className="text-ash">Retry it on the Agents page, or give a voice id in the settings.</span>
      </span>
    )
  return (
    <span className="text-ash">
      Being made from your description
      {props.voiceJob?.status === 'queued' ? ', waiting for the runner' : ''}. Videos record once it is made.
    </span>
  )
}

function SettingsForm(props: { persona: Doc<'personas'>; onDone: () => void }) {
  const update = useMutation(api.private.personas.update)
  const giveDiscountCode = useMutation(api.private.personas.giveDiscountCode)
  const personas = useQuery(api.private.personas.list, {})
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const [color, setColor] = React.useState<PersonaColor>(props.persona.color)
  const [formats, setFormats] = React.useState<PlatformFormat[]>(props.persona.formats)
  const [lookStyle, setLookStyle] = React.useState<AppearanceStyle | undefined>(props.persona.appearance?.style)
  const [lookFace, setLookFace] = React.useState<PresenterFace>(props.persona.appearance?.face ?? 'photoreal')
  const [code, setCode] = React.useState('')
  const [offer, setOffer] = React.useState('')
  const [codeState, setCodeState] = React.useState<FormState>({ status: 'idle' })
  const giveCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCodeState({ status: 'saving' })
    try {
      await giveDiscountCode({ personaId: props.persona._id, code: code.trim(), offer: offer.trim() })
      setCode('')
      setOffer('')
      setCodeState({ status: 'idle' })
    } catch (caught) {
      setCodeState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    setState({ status: 'saving' })
    try {
      await update({
        personaId: props.persona._id,
        name: text('name'),
        color,
        handle: props.persona.handle,
        niche: text('niche'),
        // Cleared, the persona has no audience: the writer then reads the niche alone.
        audience: text('audience') || undefined,
        tone: text('tone'),
        bio: text('bio'),
        bible: text('bible'),
        pillars: text('pillars')
          .split(',')
          .map((pillar) => pillar.trim())
          .filter(Boolean),
        formats,
        // Left empty while the voice is being made from its description, so the made one lands.
        voiceId: text('voiceId') || undefined,
        style: lookStyle,
        // Only a Loom-style look has a face to pick.
        face: lookStyle === 'loom' ? lookFace : undefined,
        sponsorDial: Number(form.get('sponsorDial')),
        sponsorRampEpisodes: Number(form.get('sponsorRampEpisodes')),
        episodesPerWeek: Number(form.get('episodesPerWeek')),
        autoApprove: form.get('autoApprove') === 'on',
        autoPublish: form.get('autoPublish') === 'on',
        timezone: text('timezone'),
      })
      props.onDone()
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const p = props.persona
  // Unknown until the roster loads; the swatches then name the colors other personas wear.
  const takenColors = personas?.filter((persona) => persona._id !== p._id).map((persona) => persona.color)
  return (
    <div className="card mb-8 space-y-4">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name">
          <Input name="name" defaultValue={p.name} required />
        </Field>
        <Field label="Niche" className="lg:col-span-2">
          <Input name="niche" defaultValue={p.niche} required />
        </Field>
        <Field label="Audience" className="sm:col-span-2 lg:col-span-3" hint="Who it talks to. The writer reads it with the niche.">
          <Input name="audience" defaultValue={p.audience ?? ''} />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <PersonaColorSwatches value={color} onChange={setColor} taken={takenColors} />
        </div>
        <Field label="Tone">
          <Input name="tone" defaultValue={p.tone} required />
        </Field>
        <Field label="Content pillars" hint="Comma separated." className="lg:col-span-2">
          <Input name="pillars" defaultValue={p.pillars.join(', ')} required />
        </Field>
        <Field label="Bio" className="sm:col-span-2 lg:col-span-3">
          <Input name="bio" defaultValue={p.bio} required />
        </Field>
        <Field label="Persona bible" className="sm:col-span-2 lg:col-span-3">
          <Textarea name="bible" defaultValue={p.bible} required className="min-h-28" />
        </Field>
        <Field label="Episodes a week">
          <Input name="episodesPerWeek" type="number" min={1} max={7} defaultValue={p.episodesPerWeek} />
        </Field>
        <Field label="Sponsor dial" hint="0 to 1">
          <Input name="sponsorDial" type="number" min={0} max={1} step={0.05} defaultValue={p.sponsorDial} />
        </Field>
        <Field label="Unsponsored ramp" hint="Episodes before the dial applies.">
          <Input name="sponsorRampEpisodes" type="number" min={0} defaultValue={p.sponsorRampEpisodes} />
        </Field>
        <Field label="Timezone" hint="Publish hours are local to it.">
          <Input name="timezone" defaultValue={p.timezone} required />
        </Field>
        <Field label="Voice id" hint={p.voiceId === undefined ? 'Being made from your description; or give one.' : undefined}>
          <Input name="voiceId" defaultValue={p.voiceId ?? ''} />
        </Field>
        <Field label="Look" hint="No presenter records the screen only.">
          <select
            className="field"
            value={lookStyle ?? ''}
            onChange={(event) => setLookStyle(APPEARANCE_STYLES.find((style) => style === event.target.value))}
          >
            {lookStyle === undefined && <option value="">Not set</option>}
            {APPEARANCE_STYLES.map((style) => (
              <option key={style} value={style}>
                {APPEARANCE_STYLE_LABELS[style]}
              </option>
            ))}
          </select>
        </Field>
        {lookStyle === 'loom' && (
          <Field label="Presenter in the bubble">
            <select
              className="field"
              value={lookFace}
              onChange={(event) => setLookFace(PRESENTER_FACES.find((face) => face === event.target.value) ?? lookFace)}
            >
              {PRESENTER_FACES.map((face) => (
                <option key={face} value={face}>
                  {PRESENTER_FACE_LABELS[face]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <CheckboxField label="Approval" name="autoApprove" defaultChecked={p.autoApprove}>
          Approve scripts automatically
        </CheckboxField>
        <CheckboxField
          label="Publishing"
          name="autoPublish"
          defaultChecked={p.autoPublish}
          hint="Off: each rendered episode waits for you as a publish package."
        >
          Publishes on its own
        </CheckboxField>
        <FormatFields value={formats} onChange={setFormats} className="sm:col-span-2 lg:col-span-3" />
        {state.status === 'error' && (
          <div className="sm:col-span-2 lg:col-span-3">
            <ErrorLine>{state.message}</ErrorLine>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
          <Button type="submit" variant="primary" busy={state.status === 'saving'}>
            Save
          </Button>
          <Button variant="ghost" onClick={props.onDone}>
            Cancel
          </Button>
        </div>
      </form>
      <form onSubmit={giveCode} className="grid gap-4 border-t border-mist pt-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <Eyebrow>Discount code</Eyebrow>
          <p className="mt-1 text-xs text-ash">
            Create the code in Polar first. Every video description that has not gone out yet carries it, publish packages included; X posts
            carry no code.
          </p>
        </div>
        <Field label="Code">
          <Input name="code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="ADA20" required />
        </Field>
        <Field label="Offer" className="lg:col-span-2">
          <Input
            name="offer"
            value={offer}
            onChange={(event) => setOffer(event.target.value)}
            placeholder="20% off Pro for 3 months"
            required
          />
        </Field>
        {codeState.status === 'error' && (
          <div className="sm:col-span-2 lg:col-span-3">
            <ErrorLine>{codeState.message}</ErrorLine>
          </div>
        )}
        <div className="sm:col-span-2 lg:col-span-3">
          <Button type="submit" busy={codeState.status === 'saving'}>
            Give code
          </Button>
        </div>
      </form>
    </div>
  )
}
