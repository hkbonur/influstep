import { EPISODE_STATUSES, EPISODE_STATUS_LABELS, EPISODE_STATUS_TINTS, waitsOnOperator, type EpisodeStatus } from '@influstep/shared'
import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { z } from 'zod'
import { EpisodeCard } from '@/components/episode-card'
import { Button, Empty, PageHeader, Pill, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { addDays, formatDay, todayKey, weekStart } from '@/lib/format'

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
        lead={
          loud.length > 0 ? (
            <>
              <span className="text-ink">
                {loud.length} episode{loud.length === 1 ? '' : 's'}
              </span>{' '}
              need{loud.length === 1 ? 's' : ''} you this week: {summarize(loud.map((episode) => episode.status))}.
            </>
          ) : (
            'Every persona’s plan for the week. Blue and amber wait on you, red failed, green goes out on its own.'
          )
        }
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
          ←
        </Button>
        <Button size="sm" onClick={() => setWeek(weekStart(today))} disabled={week === weekStart(today)}>
          This week
        </Button>
        <Button size="sm" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">
          →
        </Button>
        <span className="ml-2 text-sm text-graphite">
          {formatDay(week, { month: 'long', day: 'numeric' })} to{' '}
          {formatDay(addDays(week, 6), { month: 'long', day: 'numeric', year: 'numeric' })}
        </span>
        <span className="tabular ml-auto text-xs text-ash">{total} episodes</span>
      </div>

      {!data && (
        <div className="grid grid-cols-7 gap-2">
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
          Nothing is planned for this week. The writer plans as many slots as each persona publishes a week, from this week's signals and
          the persona's pillars; you approve each script.
        </Empty>
      )}
      {data && total > 0 && (
        <div className="grid grid-cols-7 gap-2 overflow-x-auto">
          {data.days.map((day) => (
            <section key={day.day} className={cn('min-w-36 rounded-xl p-1.5', { 'bg-paper-warm': day.day === today })}>
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
              </div>
            </section>
          ))}
        </div>
      )}

      <footer className="mt-6 flex flex-wrap gap-2">
        {EPISODE_STATUSES.map((status) => (
          <Pill key={status} tint={EPISODE_STATUS_TINTS[status]}>
            {EPISODE_STATUS_LABELS[status]}
          </Pill>
        ))}
      </footer>
    </>
  )
}

/** One bucket per status in the week's loud cards, "1 failed, 2 needs approval, 1 ready to publish", in the order they appear. */
function summarize(statuses: EpisodeStatus[]): string {
  const counts = new Map<EpisodeStatus, number>()
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1)
  return [...counts.entries()].map(([status, count]) => `${count} ${EPISODE_STATUS_LABELS[status].toLowerCase()}`).join(', ')
}
