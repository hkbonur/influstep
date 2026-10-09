import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import { EXPERIMENT_KIND_LABELS, METRIC_LABELS } from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { Funnel, MetricStrip, Trend } from '@/components/charts'
import { SponsorPill, StatusPill } from '@/components/status'
import { Empty, Eyebrow, LinkButton, MockNote, Mono, PageHeader, Pill, Skeleton } from '@/components/ui'
import { formatCount, formatDay, formatPercent } from '@/lib/format'

export const Route = createFileRoute('/reports/$personaId')({ component: ReportPage })

function ReportPage() {
  const params = Route.useParams()
  const personaId = params.personaId as Id<'personas'>
  const report = useQuery(api.private.report.forPersona, { personaId })
  if (report === undefined) return <Skeleton className="h-96" />
  if (report === null) return <p className="text-ash">This persona does not exist.</p>
  const { persona, funnel, trend } = report
  const signupRate = funnel.clicks === 0 ? null : funnel.signups / funnel.clicks
  const clickRate = funnel.views === 0 ? null : funnel.clicks / funnel.views
  const nothing = funnel.views === 0 && funnel.clicks === 0 && report.episodes.length === 0

  return (
    <>
      <PageHeader
        title={`${persona.name}, last ${report.windowDays} days`}
        lead={
          <>
            <Mono>@{persona.handle}</Mono> · {persona.niche}
          </>
        }
        actions={
          <LinkButton to="/personas/$personaId" params={{ personaId }} variant="ghost">
            Open persona
          </LinkButton>
        }
      />
      {nothing && <Empty>Nothing measured yet. Once an episode is live for 72 hours the analyst fills this page.</Empty>}
      {!nothing && (
        <div className="space-y-10">
          <MetricStrip
            items={[
              { label: 'Followers', value: formatCount(funnel.follows) },
              { label: 'Views', value: formatCount(funnel.views) },
              {
                label: 'Clicks',
                value: formatCount(funnel.clicks),
                note: clickRate === null ? undefined : `${formatPercent(clickRate, 2)} of views`,
              },
              {
                label: 'Attributed signups',
                value: formatCount(funnel.signups),
                note: signupRate === null ? undefined : `${formatPercent(signupRate)} of clicks`,
              },
              { label: 'Paid', value: formatCount(funnel.paid) },
            ]}
          />
          <MockNote when={funnel.mock} />

          <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
            <section>
              <Eyebrow className="mb-3">From a view to a paid plan</Eyebrow>
              <Funnel data={funnel} />
            </section>
            <section>
              <Eyebrow className="mb-3">Per day</Eyebrow>
              <Trend points={trend} />
            </section>
          </div>

          <section>
            <Eyebrow className="mb-3">Experiments</Eyebrow>
            {report.experiments.length === 0 && <p className="text-ash">No experiments for this persona.</p>}
            <ul className="space-y-3">
              {report.experiments.map((experiment) => (
                <li key={experiment._id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/experiments" className="font-medium hover:underline">
                      {experiment.name}
                    </Link>
                    <Pill tint={experiment.status === 'running' ? 'field-green' : experiment.status === 'decided' ? 'ink' : 'fog'}>
                      {experiment.status}
                    </Pill>
                    <span className="text-xs text-ash">
                      {EXPERIMENT_KIND_LABELS[experiment.kind]} on {METRIC_LABELS[experiment.metric].toLowerCase()}
                    </span>
                  </div>
                  <div className="tabular mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-graphite">
                    {experiment.stats.map((stat) => (
                      <span key={stat.key}>
                        <Mono>{stat.key}</Mono> {stat.exposures > 0 ? formatPercent(stat.rate, 2) : 'no data'}{' '}
                        <span className="text-ash">({stat.episodes} ep.)</span>
                      </span>
                    ))}
                  </div>
                  {experiment.decision && <p className="mt-1 text-xs text-ash">{experiment.decision.note}</p>}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <Eyebrow className="mb-3">Episodes</Eyebrow>
            <table className="w-full text-sm">
              <thead className="text-xs text-ash">
                <tr className="text-left">
                  <th className="py-1 font-medium">Day</th>
                  <th className="py-1 font-medium">Episode</th>
                  <th className="py-1 text-right font-medium">Views</th>
                  <th className="py-1 text-right font-medium">Follows</th>
                  <th className="py-1 text-right font-medium">Clicks</th>
                  <th className="py-1 text-right font-medium">Signups</th>
                  <th className="py-1 text-right font-medium">Paid</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {report.episodes.map((episode) => (
                  <tr key={episode._id} className="border-t border-mist">
                    <td className="py-1.5 font-mono text-xs text-ash">
                      {formatDay(episode.plannedFor, { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="py-1.5">
                      <Link to="/episodes/$episodeId" params={{ episodeId: episode._id }} className="hover:underline">
                        {episode.title}
                      </Link>
                      <span className="ml-2 inline-flex gap-1 align-middle">
                        <StatusPill status={episode.status} />
                        <SponsorPill segment={episode.sponsorSegment} />
                        {episode.variantKey && <Pill tint="fog">{episode.variantKey}</Pill>}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">{formatCount(episode.views)}</td>
                    <td className="py-1.5 text-right">{formatCount(episode.follows)}</td>
                    <td className="py-1.5 text-right">{formatCount(episode.clicks)}</td>
                    <td className="py-1.5 text-right">{episode.signups}</td>
                    <td className="py-1.5 text-right">{episode.paid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </>
  )
}
