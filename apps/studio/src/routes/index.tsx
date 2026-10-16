import { EPISODE_STATUSES, EPISODE_STATUS_LABELS, EPISODE_STATUS_TINTS, waitsOnOperator, type EpisodeStatus } from '@influstep/shared'
import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { z } from 'zod'
import { EpisodeCard } from '@/components/episode-card'
import { HomeOverview } from '@/components/home-overview'
import { Button, Empty, PageHeader, Pill, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { addDays, formatDay, plural, todayKey, weekStart } from '@/lib/format'

const searchSchema = z.object({
  week: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  persona: z.string().optional(),
})

export const Route = createFileRoute('/')({ component: CalendarPage, validateSearch: searchSchema })

function CalendarPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const today = todayKey()
  const week = search.week ?? weekStart(today)
  const personaId = search.persona ? (search.persona as Id<'personas'>) : undefined
  const data = useQuery(api.private.calendar.week, { weekStart: week, personaId })
  const personas = useQuery(api.private.personas.list, {})
  const planWeek = useMutation(api.private.personas.planWeek)
  const [planning, setPlanning] = React.useState(false)

  const setWeek = (next: string) =>
    navigate({ search: (previous) => ({ ...previous, week: next === weekStart(today) ? undefined : next }) })
  const total = data?.days.reduce((sum, day) => sum + day.episodes.length, 0) ?? 0
  const loud =
    data?.days.flatMap((day) => day.episodes).filter((episode) => waitsOnOperator(episode.status) || episode.status === 'failed') ?? []
  const thisWeek = week === weekStart(today)

  const plan = async () => {
    setPlanning(true)
    try {
      const targets = personaId ? [personaId] : (personas ?? []).filter((persona) => !persona.paused).map((persona) => persona._id)
      await Promise.all(targets.map((id) => planWeek({ personaId: id, weekStart: week })))
    } finally {
      setPlanning(false)
    }
  }

  // The first run has no roster: the calendar has nothing to show, so the operator builds one first.
  if (personas !== undefined && personas.length === 0) return <Navigate to="/onboarding" replace />

  return (
    <>
      <PageHeader
        title="Calendar"
        actions={
          <>
            <select
              value={search.persona ?? ''}
              onChange={(event) => navigate({ search: (previous) => ({ ...previous, persona: event.target.value || undefined }) })}
              className="field w-auto pr-8"
              aria-label="Persona"
            >
              <option value="">All personas</option>
              {personas?.map((persona) => (
                <option key={persona._id} value={persona._id}>
                  {persona.name}
                </option>
              ))}
            </select>
            <Button onClick={plan} busy={planning} variant="primary">
              Plan this week
            </Button>
          </>
        }
      />

      <HomeOverview />

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold">
          {formatDay(week, { month: 'long', day: 'numeric' })} to{' '}
          {formatDay(addDays(week, 6), { month: 'long', day: 'numeric', year: 'numeric' })}
        </h2>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
            ←
          </Button>
          {!thisWeek && (
            <Button size="sm" variant="ghost" onClick={() => setWeek(weekStart(today))}>
              This week
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">
            →
          </Button>
        </div>
        {data && total > 0 && (
          <p className="tabular ml-auto text-xs text-ash">
            {total} {plural(total, 'episode', 'episodes')}
            {loud.length > 0 && (
              <>
                {' · '}
                <span className="text-graphite">{summarize(loud.map((episode) => episode.status))}</span>
              </>
            )}
          </p>
        )}
      </div>

      {!data && (
        <div className="grid gap-2 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="h-64" />
          ))}
        </div>
      )}
      {data && total === 0 && (
        <Empty
          action={
            <Button onClick={plan} busy={planning}>
              Plan this week
            </Button>
          }
        >
          Nothing planned this week. The writer plans from the signals and each persona's pillars; you approve each script.
        </Empty>
      )}
      {data && total > 0 && (
        // Seven columns from md up; on a phone the days stack, today's wash and every card as they are.
        <div className="grid gap-2 md:grid-cols-7">
          {data.days.map((day) => (
            <section key={day.day} className={cn('rounded-xl p-1.5 md:min-w-36', { 'bg-paper-warm': day.day === today })}>
              <h2 className="flex items-baseline justify-between px-1 pb-2 text-xs">
                <span className={cn('font-medium text-graphite', { 'text-ink': day.day === today })}>
                  {formatDay(day.day, { weekday: 'short' })}
                </span>
                <span className="tabular font-mono text-ash">{formatDay(day.day, { day: 'numeric' })}</span>
              </h2>
              <div className="grid gap-1.5">
                {day.episodes.map((episode) => (
                  <EpisodeCard key={episode._id} episode={episode} />
                ))}
                {/* Stacked, an empty day would read as a missing one; side by side its empty column says it. */}
                {day.episodes.length === 0 && <p className="px-1 text-xs text-ash md:hidden">Nothing planned.</p>}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* The legend is for learning the dots once; after that it is noise, so it stays folded. */}
      <details className="mt-6 text-xs text-ash">
        <summary className="w-fit cursor-pointer hover:text-graphite">What the colors mean</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {EPISODE_STATUSES.map((status) => (
            <Pill key={status} tint={EPISODE_STATUS_TINTS[status]}>
              {EPISODE_STATUS_LABELS[status]}
            </Pill>
          ))}
        </div>
      </details>
    </>
  )
}

/** One bucket per status in the week's loud cards, "1 failed, 2 need approval, 1 ready to publish", in the order they appear. */
function summarize(statuses: EpisodeStatus[]): string {
  const counts = new Map<EpisodeStatus, number>()
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1)
  return [...counts.entries()]
    .map(([status, count]) => {
      const label = EPISODE_STATUS_LABELS[status].toLowerCase()
      // The labels are written for one card ("needs approval"); several need it.
      return `${count} ${count === 1 ? label : label.replace(/^needs /, 'need ')}`
    })
    .join(', ')
}
