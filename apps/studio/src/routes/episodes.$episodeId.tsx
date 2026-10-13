import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import {
  CONVERSION_KIND_LABELS,
  DELIVERY_LABELS,
  EXPERIMENT_KIND_LABELS,
  METRIC_LABELS,
  PLATFORM_LABELS,
  SIGNAL_SOURCE_LABELS,
  VALUE_LABEL,
  formatLength,
  isPost,
  platformsOpen,
  type EpisodeKind,
  type EpisodeStatus,
  type Platform,
} from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { PostEditor } from '@/components/post-editor'
import { type DraftEdit, type DraftEdits, PublicationsSection, unsavedPlatforms } from '@/components/publish-package'
import { ScriptEditor } from '@/components/script-editor'
import { JobDot, PlatformGlyphs, PostKindIcon, PostShape, SponsorPill, StatusPill } from '@/components/status'
import { AttributionNote, Button, ErrorLine, Eyebrow, type FormState, Input, MockNote, Mono, PageHeader, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatCount, formatDay, formatMoney, relativeTime } from '@/lib/format'

export const Route = createFileRoute('/episodes/$episodeId')({ component: EpisodePage })

type EpisodeData = NonNullable<FunctionReturnType<typeof api.private.episodes.get>>

/** What approving does next: a video records, an image post renders its card, a text post or a thread goes straight to the schedule. */
const APPROVE_LABEL: Record<EpisodeKind, string> = {
  video: 'Approve and record',
  image: 'Approve and render',
  text: 'Approve and schedule',
  thread: 'Approve and schedule',
}

/**
 * Where publications come from before there are any. A render makes a video's
 * or an image post's publications, which wait as a publish package unless the
 * persona publishes on its own; text posts and threads skip rendering and are
 * queued by their approval. A killed episode never gets any.
 */
function noPublicationsLine(kind: EpisodeKind, status: EpisodeStatus, autoPublish: boolean): string {
  if (status === 'killed') return 'Killed, so nothing goes out.'
  if (kind === 'text' || kind === 'thread') return 'Queued when the post is approved.'
  const rendered = kind === 'video' ? 'the episode is rendered' : 'the card is rendered'
  if (autoPublish) return `Queued when ${rendered}.`
  return `Waits for you as a publish package once ${rendered}.`
}

/**
 * Where the header's Approve and schedule stands. It is never disabled while
 * it runs, since that drops focus; a second click is ignored instead. Once it
 * went through, the count of publications it queued is said in the package's
 * live line, for the episode it was approved on.
 */
type ApprovalState = { status: 'idle' } | { status: 'approving' } | { status: 'approved'; episodeId: Id<'episodes'>; queued: number }

function queuedLine(queued: number): string {
  return queued === 1 ? '1 publication queued.' : `${queued} publications queued.`
}

function EpisodePage() {
  const params = Route.useParams()
  const episodeId = params.episodeId as Id<'episodes'>
  const data = useQuery(api.private.episodes.get, { episodeId })
  const approve = useMutation(api.private.episodes.approve)
  const kill = useMutation(api.private.episodes.kill)
  const rewrite = useMutation(api.private.episodes.rewrite)
  const retry = useMutation(api.private.episodes.retry)
  const reschedule = useMutation(api.private.episodes.reschedule)
  const retryJob = useMutation(api.private.jobs.retry)
  const approvePackage = useMutation(api.private.publications.approvePackage)
  const [error, setError] = React.useState<string | null>(null)
  const [day, setDay] = React.useState<string | null>(null)
  // Here rather than in the package: the header's Approve and schedule must not publish the saved text over an unsaved edit.
  const [draftEdits, setDraftEdits] = React.useState<DraftEdits>({})
  const [approval, setApproval] = React.useState<ApprovalState>({ status: 'idle' })
  const packageLineId = React.useId()

  if (data === undefined) return <Skeleton className="h-96" />
  if (data === null) return <p className="text-ash">This episode does not exist.</p>
  const { episode, persona } = data

  const run = (action: () => Promise<unknown>) => async () => {
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }
  const terminal = episode.status === 'measured' || episode.status === 'killed'
  const mock = data.renders.some((render) => render.mock) || data.publications.some((publication) => publication.mock) || data.value.mock
  const openItems = data.checklist.filter((item) => item.status === 'open')
  const showValue = episode.status === 'published' || episode.status === 'measured' || data.value.clicks > 0
  const carriesCode = !isPost(episode.kind) && episode.platforms.some((platform) => platform !== 'x')
  const packageWaits = episode.status === 'rendered' && data.publications.some((publication) => publication.status === 'draft')
  const unsaved = unsavedPlatforms(data.publications, draftEdits)
  const editDraft = (publicationId: Id<'publications'>, edit: DraftEdit | null) =>
    setDraftEdits((current) => ({ ...current, [publicationId]: edit === null ? undefined : edit }))
  const approveAndSchedule = async () => {
    // A second click while the first is out would be refused as already scheduled, and that refusal would read as a failure.
    if (approval.status === 'approving') return
    setError(null)
    setApproval({ status: 'approving' })
    try {
      const queued = await approvePackage({ episodeId })
      setApproval({ status: 'approved', episodeId, queued })
      // The button leaves with the package's wait; focus goes to the line that says what happened, not to the top of the page.
      document.getElementById(packageLineId)?.focus()
    } catch (caught) {
      setApproval({ status: 'idle' })
      setError(errorMessage(caught))
    }
  }
  const packageNotice = approval.status === 'approved' && approval.episodeId === episodeId ? queuedLine(approval.queued) : null

  return (
    <>
      <PageHeader
        title={episode.title}
        lead={
          <>
            <Link to="/personas/$personaId" params={{ personaId: persona._id }} className="hover:underline">
              {persona.name}
            </Link>{' '}
            <Mono className="text-ash">@{persona.handle}</Mono> ·{' '}
            {formatDay(episode.plannedFor, { weekday: 'long', month: 'long', day: 'numeric' })} · <StatusPill status={episode.status} />{' '}
            <SponsorPill segment={episode.sponsorSegment} /> <PlatformGlyphs platforms={episode.platforms} />
            {isPost(episode.kind) && (
              <span className="ml-1 inline-flex items-center gap-1 whitespace-nowrap text-graphite">
                <PostKindIcon kind={episode.kind} showLabel />
              </span>
            )}
            {/* What the planner asked of the post, as plain text: the writer reads it, the operator edits the post itself. */}
            <PostShape intent={episode.intent} length={episode.length} className="ml-2 text-xs whitespace-nowrap" />
            {episode.format && (
              <>
                {' '}
                <Mono className="whitespace-nowrap text-ash">
                  {formatLength(episode.format.lengthSec)} · {DELIVERY_LABELS[episode.format.delivery]}
                </Mono>
              </>
            )}
          </>
        }
        actions={
          <>
            {episode.status === 'scripted' && (
              <Button variant="primary" onClick={run(() => approve({ episodeId }))}>
                {APPROVE_LABEL[episode.kind]}
              </Button>
            )}
            {packageWaits && (
              <Button
                variant="primary"
                disabled={unsaved.length > 0}
                aria-busy={approval.status === 'approving'}
                onClick={approveAndSchedule}
              >
                Approve and schedule
              </Button>
            )}
            {episode.status === 'failed' && (
              <Button variant="primary" onClick={run(() => retry({ episodeId }))}>
                Retry
              </Button>
            )}
            {(episode.status === 'scripted' || episode.status === 'idea' || episode.status === 'failed') && (
              <Button onClick={run(() => rewrite({ episodeId }))}>Rewrite</Button>
            )}
            {!terminal && (
              <Button variant="destructive" onClick={run(() => kill({ episodeId }))}>
                Kill
              </Button>
            )}
          </>
        }
      />
      {/* A post goes only to X, so it has nothing to choose here. */}
      {isPost(episode.kind) ? (
        <p className="mb-6 text-sm">Goes to {PLATFORM_LABELS.x}</p>
      ) : (
        <PlatformsSection
          episodeId={episodeId}
          platforms={episode.platforms}
          personaPlatforms={data.personaPlatforms}
          locked={!platformsOpen(episode.status)}
        />
      )}
      {/* Stays mounted, so a refused header action is announced where it appears, above the content. */}
      <div aria-live="polite">
        {error && (
          <div className="mb-4">
            <ErrorLine>{error}</ErrorLine>
          </div>
        )}
      </div>
      {episode.error && (
        <div className="mb-6">
          <ErrorLine>{episode.error}</ErrorLine>
        </div>
      )}

      {openItems.length > 0 && (
        <section className="mb-8 rounded-xl bg-alert-amber/8 px-4 py-3">
          <Eyebrow className="mb-2 text-alert-amber-deep">Waiting on you</Eyebrow>
          <ul className="space-y-1 text-sm">
            {openItems.map((item) => (
              <li key={item._id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{item.title}</span>
                <span className="text-ash">{item.why}</span>
                <Link to="/checklist" className="text-xs underline">
                  Checklist
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-8">
          {/* Once there are publications they lead the page: at "Ready to publish" they are what the operator acts on. */}
          {data.publications.length > 0 && (
            <PublicationsSection
              kind={episode.kind}
              episodeStatus={episode.status}
              timezone={persona.timezone}
              publications={data.publications}
              links={data.links}
              appUrl={data.appUrl}
              codesSent={data.codesSent}
              edits={draftEdits}
              onEdit={editDraft}
              notice={packageNotice}
              statusId={packageLineId}
            />
          )}
          <section>
            <Eyebrow className="mb-3">{isPost(episode.kind) ? 'Post' : 'Script'}</Eyebrow>
            <p className="mb-3 text-ash">
              Concept: {episode.concept}
              {episode.pillar && <span> · pillar: {episode.pillar}</span>}
            </p>
            {isPost(episode.kind) ? (
              // Keyed on the post it edits, like the script editor: a saved or rewritten post remounts it.
              <PostEditor
                key={[episode.title, ...(episode.post?.parts ?? []), episode.post?.cardTitle ?? ''].join('\u0000')}
                episode={episode}
                kind={episode.kind}
                persona={{ name: persona.name, handle: persona.handle }}
                card={cardOf(data)}
              />
            ) : (
              // Keyed on the beats it edits: saved or rewritten beats remount it, a platform change or a move does not.
              <ScriptEditor
                key={[episode.title, ...(episode.shotPlan ?? []).flatMap((beat) => [beat.title, beat.voiceover])].join('\u0000')}
                episode={episode}
                sponsorName={data.sponsorName}
              />
            )}
          </section>

          {!isPost(episode.kind) && <ShotsSection shots={episode.shots} />}
        </div>

        <div className="space-y-8">
          {/*
            Before there are publications: a video's renders, if any, and where its publications will come from. Once they
            exist the package shows each render in its block. An image post's one render is its card, shown in the post editor.
          */}
          {data.publications.length === 0 && (
            <section>
              <Eyebrow className="mb-3">Publications</Eyebrow>
              <p className="text-ash">{noPublicationsLine(episode.kind, episode.status, persona.autoPublish)}</p>
              {/* Nothing is appended on X, posts and videos alike, so the code line speaks only for a video's other platforms. */}
              {carriesCode && episode.status !== 'killed' && <CodeInForce code={data.discountCode} />}
            </section>
          )}
          {data.publications.length === 0 && episode.kind === 'video' && data.renders.length > 0 && (
            <RendersSection renders={data.renders} />
          )}

          {showValue && (
            <section className="space-y-3">
              <Eyebrow>{VALUE_LABEL}</Eyebrow>
              <dl className="tabular grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-ash">{METRIC_LABELS.clicks}</dt>
                <dd>{formatCount(data.value.clicks)}</dd>
                <dt className="text-ash">{CONVERSION_KIND_LABELS.demo_started}</dt>
                <dd>{data.value.demos}</dd>
                <dt className="text-ash">{CONVERSION_KIND_LABELS.signup}</dt>
                <dd>{data.value.signups}</dd>
                <dt className="text-ash">{CONVERSION_KIND_LABELS.trial_started}</dt>
                <dd>{data.value.trials}</dd>
                <dt className="text-ash">{CONVERSION_KIND_LABELS.paid}</dt>
                <dd>
                  {data.value.paid}
                  {data.value.paidViaCode > 0 && <span className="text-xs text-ash"> ({data.value.paidViaCode} via code)</span>}
                </dd>
                <dt className="text-ash">{VALUE_LABEL}</dt>
                <dd className="font-medium">{formatMoney(data.value.value, data.currency)}</dd>
              </dl>
              <AttributionNote />
            </section>
          )}

          {data.snapshots.length > 0 && (
            <section>
              <Eyebrow className="mb-3">Metrics</Eyebrow>
              <Snapshots snapshots={data.snapshots} />
            </section>
          )}

          <section>
            <Eyebrow className="mb-3">Schedule</Eyebrow>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={day ?? episode.plannedFor}
                onChange={(event) => setDay(event.target.value)}
                className="w-auto"
                disabled={terminal}
                aria-label="Planned day"
              />
              <Button
                size="sm"
                disabled={terminal || !day || day === episode.plannedFor}
                onClick={run(() => reschedule({ episodeId, plannedFor: day ?? episode.plannedFor }))}
              >
                Move
              </Button>
            </div>
          </section>

          {(data.experiment || data.signals.length > 0) && (
            <section>
              <Eyebrow className="mb-3">Why this episode</Eyebrow>
              {data.experiment && (
                <p className="text-sm">
                  Experiment{' '}
                  <Link to="/experiments" className="font-medium hover:underline">
                    {data.experiment.name}
                  </Link>{' '}
                  ({EXPERIMENT_KIND_LABELS[data.experiment.kind]}), variant <Mono>{episode.variantKey}</Mono>
                </p>
              )}
              <ul className="mt-1 space-y-1 text-sm">
                {data.signals.map((signal) => (
                  <li key={signal._id}>
                    <span className="text-xs text-ash">{SIGNAL_SOURCE_LABELS[signal.source]}</span>{' '}
                    <a href={signal.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {signal.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <Eyebrow className="mb-3">Jobs</Eyebrow>
            <ul className="space-y-1.5 font-mono text-[11px]">
              {data.jobs.map((job) => (
                <li key={job._id} className="flex items-start gap-2">
                  <JobDot status={job.status} className="mt-1" />
                  <span className="text-graphite">{job.kind}</span>
                  <span className="text-ash">
                    {job.runsOn} · {job.status} · {relativeTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}
                  </span>
                  {job.status === 'failed' && (
                    <button type="button" className="ml-auto text-ink hover:underline" onClick={run(() => retryJob({ jobId: job._id }))}>
                      retry
                    </button>
                  )}
                  {job.error && <span className="basis-full text-signal-red-deep">{job.error}</span>}
                </li>
              ))}
            </ul>
          </section>
          <MockNote when={mock} />
        </div>
      </div>
    </>
  )
}

/**
 * Where this episode goes: a subset of the persona's platforms, editable
 * until it is approved. The checked state is the server's; a failed save
 * snaps the box back and says why. The last box the persona still offers
 * cannot be cleared.
 */
function PlatformsSection(props: { episodeId: Id<'episodes'>; platforms: Platform[]; personaPlatforms: Platform[]; locked: boolean }) {
  const setPlatforms = useMutation(api.private.episodes.setPlatforms)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const toggle = async (platform: Platform, on: boolean) => {
    const next = props.personaPlatforms.filter((candidate) => {
      if (candidate === platform) return on
      return props.platforms.includes(candidate)
    })
    setState({ status: 'saving' })
    try {
      await setPlatforms({ episodeId: props.episodeId, platforms: next })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <section className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
      <Eyebrow>Platforms</Eyebrow>
      {props.personaPlatforms.map((platform) => {
        const on = props.platforms.includes(platform)
        const lastOffered = on && props.platforms.filter((candidate) => props.personaPlatforms.includes(candidate)).length === 1
        return (
          <label key={platform} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="size-3.5 accent-ink"
              checked={on}
              disabled={props.locked || state.status === 'saving' || lastOffered}
              onChange={(event) => toggle(platform, event.target.checked)}
            />
            {PLATFORM_LABELS[platform]}
          </label>
        )
      })}
      {props.locked && <span className="text-xs text-ash">Platforms lock at approval.</span>}
      {state.status === 'error' && (
        <div className="basis-full">
          <ErrorLine>{state.message}</ErrorLine>
        </div>
      )}
    </section>
  )
}

/**
 * The code every description carries when it goes out, since the lines
 * around a description are composed at dispatch: the code in force then, not
 * at render. Shown before there are publications; after that each block of
 * the package shows its own lines.
 */
function CodeInForce(props: { code: { code: string; offer: string } | null }) {
  if (props.code === null) return <p className="mt-2 text-sm text-ash">No discount code in force.</p>
  return (
    <p className="mt-2 text-sm">
      Code in force: <Mono>{props.code.code}</Mono> <span className="text-ash">({props.code.offer})</span>. A description carries the code
      in force when it goes out.
    </p>
  )
}

function Snapshots(props: {
  snapshots: {
    _id: string
    platform?: string
    takenAt: number
    counts: { views: number; follows: number; clicks: number; signups: number; likes: number; comments: number }
  }[]
}) {
  const latest = [...props.snapshots].sort((a, b) => b.takenAt - a.takenAt)
  const seen = new Set<string>()
  const rows = latest.filter((snapshot) => {
    const key = snapshot.platform ?? 'all'
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return (
    <table className="w-full text-xs">
      <thead className="text-ash">
        <tr className="text-left">
          <th className="py-1 font-medium">Platform</th>
          <th className="py-1 text-right font-medium">Views</th>
          <th className="py-1 text-right font-medium">Follows</th>
          <th className="py-1 text-right font-medium">Likes</th>
          <th className="py-1 text-right font-medium">Comments</th>
        </tr>
      </thead>
      <tbody className="tabular">
        {rows.map((snapshot) => (
          <tr key={snapshot._id} className="border-t border-mist">
            <td className="py-1">{snapshot.platform ? PLATFORM_LABELS[snapshot.platform as keyof typeof PLATFORM_LABELS] : 'All'}</td>
            <td className="py-1 text-right">{formatCount(snapshot.counts.views)}</td>
            <td className="py-1 text-right">{formatCount(snapshot.counts.follows)}</td>
            <td className="py-1 text-right">{formatCount(snapshot.counts.likes)}</td>
            <td className="py-1 text-right">{formatCount(snapshot.counts.comments)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ShotsSection(props: { shots: EpisodeData['episode']['shots'] }) {
  return (
    <section>
      <Eyebrow className="mb-3">Shots</Eyebrow>
      {props.shots.length === 0 && <p className="text-ash">The writer adds shots with the script.</p>}
      <ol className="space-y-2">
        {props.shots.map((shot, index) => (
          <li key={shot.id} className="flex gap-3 text-sm">
            <span className="tabular w-5 shrink-0 font-mono text-xs text-ash">{index + 1}</span>
            <div className="min-w-0">
              <p>
                <span className="font-medium">{shot.title}</span> <span className="text-xs text-ash">{shot.kind}</span>
              </p>
              <p className="text-xs text-graphite">{shot.voiceover}</p>
              {shot.kind === 'screen' && (
                <p className="mt-0.5 font-mono text-[11px] text-ash">
                  {shot.recipe
                    .map((step) =>
                      step.step === 'goto'
                        ? step.url
                        : step.step === 'wait'
                          ? `wait ${step.ms}ms`
                          : step.step === 'scroll'
                            ? `scroll ${step.y}`
                            : `${step.step} ${step.selector}`
                    )
                    .join(' › ')}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function RendersSection(props: { renders: EpisodeData['renders'] }) {
  return (
    <section>
      <Eyebrow className="mb-3">Renders</Eyebrow>
      <div className="flex flex-wrap gap-3">
        {props.renders.map((render) => (
          <figure key={render.aspect} className="w-40">
            {render.url && (
              <video
                src={render.url}
                controls
                preload="metadata"
                className={cn('w-full rounded-lg bg-ink-deep', {
                  'aspect-video': render.aspect === '16:9',
                  'aspect-[9/16]': render.aspect === '9:16',
                })}
              />
            )}
            <figcaption className="tabular mt-1 font-mono text-[11px] text-ash">
              {render.aspect} · {Math.round(render.durationSec)} s{render.mock && ' · mock'}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}

/** An image post's card: its one render once the producer made it, null before. */
function cardOf(data: EpisodeData): { url: string | null; mock: boolean } | null {
  const [render] = data.renders
  if (!render) return null
  return { url: render.url, mock: render.mock }
}
