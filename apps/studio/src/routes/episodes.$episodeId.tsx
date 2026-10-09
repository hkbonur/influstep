import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import { EXPERIMENT_KIND_LABELS, PLATFORM_LABELS, SIGNAL_SOURCE_LABELS } from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { ScriptEditor } from '@/components/script-editor'
import { SponsorPill, StatusPill } from '@/components/status'
import { Button, ErrorLine, Eyebrow, Input, MockNote, Mono, PageHeader, Pill, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatCount, formatDateTime, formatDay, relativeTime } from '@/lib/format'

export const Route = createFileRoute('/episodes/$episodeId')({ component: EpisodePage })

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
  const [error, setError] = React.useState<string | null>(null)
  const [day, setDay] = React.useState<string | null>(null)

  if (data === undefined) return <Skeleton className="h-96" />
  if (data === null) return <p className="text-ash">This episode does not exist.</p>
  const { episode, persona } = data

  const run = (action: () => Promise<unknown>) => async () => {
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }
  const terminal = episode.status === 'measured' || episode.status === 'killed'
  const mock = data.renders.some((render) => render.mock) || data.publications.some((publication) => publication.mock)
  const openItems = data.checklist.filter((item) => item.status === 'open')

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
            <SponsorPill segment={episode.sponsorSegment} />
          </>
        }
        actions={
          <>
            {episode.status === 'scripted' && (
              <Button variant="primary" onClick={run(() => approve({ episodeId }))}>
                Approve and record
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
      {error && (
        <div className="mb-4">
          <ErrorLine>{error}</ErrorLine>
        </div>
      )}
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
          <section>
            <Eyebrow className="mb-3">Script</Eyebrow>
            <p className="mb-3 text-ash">
              Concept: {episode.concept}
              {episode.pillar && <span> · pillar: {episode.pillar}</span>}
            </p>
            <ScriptEditor key={episode.updatedAt} episode={episode} sponsorName="Formstep" />
          </section>

          <section>
            <Eyebrow className="mb-3">Shots</Eyebrow>
            {episode.shots.length === 0 && <p className="text-ash">The writer adds shots with the script.</p>}
            <ol className="space-y-2">
              {episode.shots.map((shot, index) => (
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
        </div>

        <div className="space-y-8">
          <section>
            <Eyebrow className="mb-3">Renders</Eyebrow>
            {data.renders.length === 0 && <p className="text-ash">Nothing rendered yet.</p>}
            <div className="flex flex-wrap gap-3">
              {data.renders.map((render) => (
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

          <section>
            <Eyebrow className="mb-3">Publications</Eyebrow>
            {data.publications.length === 0 && <p className="text-ash">Queued when the episode is approved and rendered.</p>}
            <ul className="divide-y divide-mist border-y border-mist">
              {data.publications.map((publication) => {
                const link = data.links.find((candidate) => candidate._id === publication.linkId)
                return (
                  <li key={publication._id} className="grid gap-0.5 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{PLATFORM_LABELS[publication.platform]}</span>
                      <Pill
                        tint={
                          publication.status === 'live'
                            ? 'field-green'
                            : publication.status === 'failed'
                              ? 'signal-red'
                              : publication.status === 'uploading'
                                ? 'note-blue'
                                : 'fog'
                        }
                      >
                        {publication.status}
                      </Pill>
                      <span className="tabular ml-auto font-mono text-[11px] text-ash">
                        {publication.publishedAt ? formatDateTime(publication.publishedAt) : `due ${relativeTime(publication.scheduledAt)}`}
                      </span>
                    </div>
                    {publication.url && (
                      <a
                        href={publication.url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate font-mono text-[11px] text-graphite hover:underline"
                      >
                        {publication.url}
                      </a>
                    )}
                    {link && (
                      <span className="font-mono text-[11px] text-ash">
                        {data.appUrl}/go/{link.slug} · {link.clicks} clicks
                      </span>
                    )}
                    {publication.error && <ErrorLine>{publication.error}</ErrorLine>}
                  </li>
                )
              })}
            </ul>
          </section>

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
                  <span
                    aria-hidden
                    className={cn('mt-1 size-1.5 shrink-0 rounded-full', {
                      'bg-field-green': job.status === 'done',
                      'bg-signal-red': job.status === 'failed',
                      'bg-note-blue': job.status === 'running',
                      'bg-fog': job.status === 'queued',
                    })}
                  />
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
