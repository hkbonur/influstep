import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import { CONVERSION_KIND_LABELS, EXPERIMENT_KIND_LABELS, METRIC_LABELS, PLATFORM_LABELS, VALUE_LABEL } from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { Funnel, MetricStrip, Trend } from '@/components/charts'
import { PlatformGlyphs, SponsorPill, StatusPill } from '@/components/status'
import { AttributionNote, Empty, Eyebrow, LinkButton, MockNote, Mono, PageHeader, Pill, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatCount, formatDay, formatMoney, formatPercent } from '@/lib/format'

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
          <div className="space-y-3">
            <MetricStrip
              items={[
                { label: 'Followers', value: formatCount(funnel.follows) },
                { label: METRIC_LABELS.views, value: formatCount(funnel.views) },
                {
                  label: METRIC_LABELS.clicks,
                  value: formatCount(funnel.clicks),
                  note: clickRate === null ? undefined : `${formatPercent(clickRate, 2)} of views`,
                },
                {
                  label: CONVERSION_KIND_LABELS.signup,
                  value: formatCount(funnel.signups),
                  note: signupRate === null ? undefined : `${formatPercent(signupRate)} of clicks`,
                },
                {
                  label: CONVERSION_KIND_LABELS.paid,
                  value: formatCount(funnel.paid),
                  note: funnel.paidViaCode > 0 ? `${funnel.paidViaCode} via code` : undefined,
                },
                { label: VALUE_LABEL, value: formatMoney(funnel.value, report.currency) },
              ]}
            />
            <AttributionNote />
            <MockNote when={funnel.mock} />
          </div>

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
            <Eyebrow className="mb-3">By platform</Eyebrow>
            {/* One row per platform the persona has, counting live publications only; zeros until one is live there, never empty. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-ash">
                  <tr className="text-left">
                    <th className="py-1 font-medium">Platform</th>
                    <th className="py-1 pl-3 text-right font-medium">Live</th>
                    <th className="py-1 pl-3 text-right font-medium">{METRIC_LABELS.views}</th>
                    <th className="py-1 pl-3 text-right font-medium">{METRIC_LABELS.follows}</th>
                    <th className="hidden py-1 pl-3 text-right font-medium lg:table-cell">Likes</th>
                    <th className="hidden py-1 pl-3 text-right font-medium lg:table-cell">Comments</th>
                    <th className="py-1 pl-3 text-right font-medium">{METRIC_LABELS.clicks}</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {report.platforms.map((row) => (
                    <tr key={row.platform} className="border-t border-mist">
                      <td className="py-1.5">
                        <span className="inline-flex items-center gap-2">
                          {/* The name follows, so the glyph is hidden from screen readers, which would say the platform twice. */}
                          <span aria-hidden>
                            <PlatformGlyphs platforms={[row.platform]} />
                          </span>
                          {PLATFORM_LABELS[row.platform]}
                        </span>
                      </td>
                      <td className="py-1.5 pl-3 text-right">{row.publications}</td>
                      <td className="py-1.5 pl-3 text-right">{formatCount(row.views)}</td>
                      <td className="py-1.5 pl-3 text-right">{formatCount(row.follows)}</td>
                      <td className="hidden py-1.5 pl-3 text-right lg:table-cell">{formatCount(row.likes)}</td>
                      <td className="hidden py-1.5 pl-3 text-right lg:table-cell">{formatCount(row.comments)}</td>
                      <td className="py-1.5 pl-3 text-right">{formatCount(row.clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <Eyebrow className="mb-3">Top episodes</Eyebrow>
            {report.topByValue.length === 0 && <p className="text-ash">No episode has clicks or a paid conversion yet.</p>}
            {report.topByValue.length > 0 && (
              <ol className="divide-y divide-mist border-y border-mist">
                {report.topByValue.map((episode) => (
                  <li
                    key={episode._id}
                    className="tabular grid grid-cols-[1fr_auto] items-baseline gap-x-5 py-2 text-sm sm:grid-cols-[1fr_auto_auto_auto]"
                  >
                    <Link to="/episodes/$episodeId" params={{ episodeId: episode._id }} className="truncate font-medium hover:underline">
                      {episode.title}
                    </Link>
                    <span className={cn('text-right', { 'text-ash': episode.value === 0 })}>
                      {formatMoney(episode.value, report.currency)}
                    </span>
                    <span className="hidden text-right text-xs text-ash sm:inline">{episode.paid} paid</span>
                    <span className="hidden text-right text-xs text-ash sm:inline">{formatCount(episode.clicks)} clicks</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-ash">
                  <tr className="text-left">
                    <th className="py-1 font-medium">Day</th>
                    <th className="py-1 font-medium">Episode</th>
                    <th className="py-1 pl-3 text-right font-medium">{METRIC_LABELS.views}</th>
                    <th className="py-1 pl-3 text-right font-medium">{METRIC_LABELS.follows}</th>
                    <th className="py-1 pl-3 text-right font-medium">{METRIC_LABELS.clicks}</th>
                    <th className="hidden py-1 pl-3 text-right font-medium lg:table-cell">{CONVERSION_KIND_LABELS.demo_started}</th>
                    <th className="py-1 pl-3 text-right font-medium">{CONVERSION_KIND_LABELS.signup}</th>
                    <th className="hidden py-1 pl-3 text-right font-medium lg:table-cell">{CONVERSION_KIND_LABELS.trial_started}</th>
                    <th className="py-1 pl-3 text-right font-medium">{CONVERSION_KIND_LABELS.paid}</th>
                    <th className="py-1 pl-3 text-right font-medium">{VALUE_LABEL}</th>
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
                      <td className="py-1.5 pl-3 text-right">{formatCount(episode.views)}</td>
                      <td className="py-1.5 pl-3 text-right">{formatCount(episode.follows)}</td>
                      <td className="py-1.5 pl-3 text-right">{formatCount(episode.clicks)}</td>
                      <td className="hidden py-1.5 pl-3 text-right lg:table-cell">{episode.demos}</td>
                      <td className="py-1.5 pl-3 text-right">{episode.signups}</td>
                      <td className="hidden py-1.5 pl-3 text-right lg:table-cell">{episode.trials}</td>
                      <td className="py-1.5 pl-3 text-right">{episode.paid}</td>
                      <td className="py-1.5 pl-3 text-right">{formatMoney(episode.value, report.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <Eyebrow className="mb-3">Discount codes</Eyebrow>
            {report.discountCodes.length === 0 && (
              <Empty
                action={
                  <LinkButton to="/personas/$personaId" params={{ personaId }}>
                    Give a code
                  </LinkButton>
                }
              >
                No code yet.
              </Empty>
            )}
            {report.discountCodes.length > 0 && (
              <ul className="divide-y divide-mist border-y border-mist">
                {report.discountCodes.map((discountCode) => (
                  <li key={discountCode._id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
                    <Mono>{discountCode.code}</Mono>
                    <span>{discountCode.offer}</span>
                    <span className="tabular text-xs text-ash">{discountCode.redemptions} redemptions</span>
                    {discountCode.episodeTitle && <span className="text-xs text-ash">for {discountCode.episodeTitle}</span>}
                    {!discountCode.episodeTitle && <span className="text-xs text-ash">persona-wide</span>}
                    {!discountCode.active && <Pill tint="fog">retired</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  )
}
