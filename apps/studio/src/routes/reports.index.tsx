import { api } from '@influstep/convex/_generated/api'
import { CONVERSION_KIND_LABELS, METRIC_LABELS, VALUE_LABEL } from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { Funnel, MetricStrip, reportStrip } from '@/components/charts'
import { PersonaAvatar } from '@/components/persona-avatar'
import { AttributionNote, Empty, Eyebrow, MockNote, Mono, PageHeader, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatCount, formatMoney, formatPercent, plural } from '@/lib/format'

export const Route = createFileRoute('/reports/')({ component: WorkspaceReport })

type Report = FunctionReturnType<typeof api.private.report.forWorkspace>
type Funnel = Report['total']
type Group = Report['whatWorks']['pillar'][number]

/**
 * The workspace report (DESIGN.md, Reports): every persona together, then one
 * row per persona with the same columns, then what works across them. A
 * persona's row opens its own report, whose funnel is the same reading.
 */
function WorkspaceReport() {
  const report = useQuery(api.private.report.forWorkspace, {})
  if (report === undefined) return <Skeleton className="h-96" />
  const { total } = report
  return (
    <>
      <PageHeader
        title={`Reports, last ${report.windowDays} days`}
        lead="Every persona together. Open a persona for its days, its episodes and its experiments."
      />
      {report.personas.length === 0 && <Empty>No personas to report on.</Empty>}
      {report.personas.length > 0 && (
        <div className="space-y-10">
          <div className="space-y-3">
            <MetricStrip items={reportStrip(total, report.currency)} />
            <EngagementLine funnel={total} />
            <AttributionNote />
            <MockNote when={total.mock} />
          </div>

          <section className="max-w-2xl">
            <Eyebrow className="mb-3">From a view to a paid plan</Eyebrow>
            <Funnel data={total} />
          </section>

          <section>
            <Eyebrow className="mb-3">Personas</Eyebrow>
            <PersonaTable report={report} />
          </section>

          <WhatWorks report={report} />
        </div>
      )}
    </>
  )
}

function followsPerView(funnel: Funnel): string {
  return funnel.views === 0 ? '–' : formatPercent(funnel.follows / funnel.views, 2)
}

function watchRate(funnel: Funnel): string {
  return funnel.watchRate === null ? '–' : formatPercent(funnel.watchRate, 0)
}

/** How the audience took what it saw, from the platforms' own counts, in one line under the strip. */
function EngagementLine(props: { funnel: Funnel }) {
  const items = [
    { label: 'Likes', value: formatCount(props.funnel.likes) },
    { label: 'Comments', value: formatCount(props.funnel.comments) },
    { label: 'Watch rate', value: watchRate(props.funnel) },
    { label: 'Follows per view', value: followsPerView(props.funnel) },
  ]
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt className="text-ash">{item.label}</dt>
          <dd className="tabular text-graphite">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

const NUMBER_CELL = 'py-1.5 pl-3 text-right'
const HEAD_CELL = 'py-1 pl-3 text-right font-medium'

/** One row per persona, the most value first, with the strip's columns and the engagement line's; the totals close it. */
function PersonaTable(props: { report: Report }) {
  const { report } = props
  const cells = (funnel: Funnel) => (
    <>
      <td className={NUMBER_CELL}>{formatCount(funnel.views)}</td>
      <td className={NUMBER_CELL}>{formatCount(funnel.follows)}</td>
      <td className={NUMBER_CELL}>{formatCount(funnel.clicks)}</td>
      <td className={cn(NUMBER_CELL, 'hidden lg:table-cell')}>{funnel.demos}</td>
      <td className={NUMBER_CELL}>{funnel.signups}</td>
      <td className={cn(NUMBER_CELL, 'hidden lg:table-cell')}>{funnel.trials}</td>
      <td className={NUMBER_CELL}>{funnel.paid}</td>
      <td className={NUMBER_CELL}>{formatMoney(funnel.value, report.currency)}</td>
      <td className={cn(NUMBER_CELL, 'hidden xl:table-cell')}>{formatCount(funnel.likes)}</td>
      <td className={cn(NUMBER_CELL, 'hidden xl:table-cell')}>{formatCount(funnel.comments)}</td>
      <td className={cn(NUMBER_CELL, 'hidden xl:table-cell')}>{watchRate(funnel)}</td>
      <td className={cn(NUMBER_CELL, 'hidden lg:table-cell')}>{followsPerView(funnel)}</td>
    </>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-ash">
          <tr className="text-left">
            <th className="py-1 font-medium">Persona</th>
            <th className={HEAD_CELL}>{METRIC_LABELS.views}</th>
            <th className={HEAD_CELL}>{METRIC_LABELS.follows}</th>
            <th className={HEAD_CELL}>{METRIC_LABELS.clicks}</th>
            <th className={cn(HEAD_CELL, 'hidden lg:table-cell')}>{CONVERSION_KIND_LABELS.demo_started}</th>
            <th className={HEAD_CELL}>{CONVERSION_KIND_LABELS.signup}</th>
            <th className={cn(HEAD_CELL, 'hidden lg:table-cell')}>{CONVERSION_KIND_LABELS.trial_started}</th>
            <th className={HEAD_CELL}>{CONVERSION_KIND_LABELS.paid}</th>
            <th className={HEAD_CELL}>{VALUE_LABEL}</th>
            <th className={cn(HEAD_CELL, 'hidden xl:table-cell')}>Likes</th>
            <th className={cn(HEAD_CELL, 'hidden xl:table-cell')}>Comments</th>
            <th className={cn(HEAD_CELL, 'hidden xl:table-cell')}>Watch rate</th>
            <th className={cn(HEAD_CELL, 'hidden lg:table-cell')}>Follows per view</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {report.personas.map((row) => (
            <tr key={row.persona._id} className="border-t border-mist">
              <td className="py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <PersonaAvatar color={row.persona.color} state="idle" size={20} className={cn({ 'text-fog': row.persona.paused })} />
                  <Link to="/reports/$personaId" params={{ personaId: row.persona._id }} className="truncate font-medium hover:underline">
                    {row.persona.name}
                  </Link>
                  {row.persona.paused && <span className="text-xs text-ash">paused</span>}
                </span>
              </td>
              {cells(row.funnel)}
            </tr>
          ))}
        </tbody>
        {report.personas.length > 1 && (
          <tfoot className="tabular border-t border-fog font-medium">
            <tr>
              <td className="py-1.5">All personas</td>
              {cells(report.total)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/**
 * Three ranked lists over every persona's measured videos (core/report.ts
 * `whatWorks`): the facts the weekly strategy review moves pillar weight on.
 */
function WhatWorks(props: { report: Report }) {
  const { whatWorks, currency } = props.report
  const hooked = whatWorks.hook.reduce((sum, group) => sum + group.videos, 0)
  return (
    <section>
      <Eyebrow className="mb-1">What works</Eyebrow>
      <p className="mb-4 max-w-[65ch] text-xs text-ash">
        <span className="tabular">{whatWorks.videos}</span> measured {plural(whatWorks.videos, 'video', 'videos')} of the last{' '}
        {props.report.whatWorksDays} days, every persona together, ranked by value per video, then clicks per view. Each persona's strategy
        review moves its pillar weights on the same numbers.
      </p>
      {whatWorks.videos === 0 && <p className="text-ash">No video has been measured in that time yet.</p>}
      {whatWorks.videos > 0 && (
        <div className="grid gap-8 lg:grid-cols-3">
          <GroupList title="By pillar" groups={whatWorks.pillar} currency={currency} empty="None of these videos has a pillar." />
          <GroupList
            title="By hook style"
            groups={whatWorks.hook}
            currency={currency}
            empty="None of these videos was written with its hook style recorded."
            note={
              hooked < whatWorks.videos ? `${whatWorks.videos - hooked} written before hook styles were recorded are left out.` : undefined
            }
          />
          <GroupList
            title="By sponsor segment"
            groups={whatWorks.sponsor}
            currency={currency}
            empty="No video here has a sponsor segment."
          />
        </div>
      )}
    </section>
  )
}

function GroupList(props: { title: string; groups: Group[]; currency: string; empty: string; note?: string }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-xs font-medium text-graphite">{props.title}</h3>
      {props.groups.length === 0 && <p className="text-ash">{props.empty}</p>}
      {props.groups.length > 0 && (
        <ol className="divide-y divide-mist border-y border-mist">
          {props.groups.map((group) => (
            <li key={group.key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-2 text-sm">
              <span className="truncate">{group.label}</span>
              <span className="tabular text-right">
                {formatMoney(group.valuePerVideo, props.currency)}
                <span className="text-xs text-ash"> per video</span>
              </span>
              <span className="tabular col-span-2 text-xs text-ash">
                {formatPercent(group.clicksPerView, 2)} clicks per view · <Mono>{group.videos}</Mono>{' '}
                {plural(group.videos, 'video', 'videos')}
              </span>
            </li>
          ))}
        </ol>
      )}
      {props.note && <p className="mt-2 text-xs text-ash">{props.note}</p>}
    </div>
  )
}
