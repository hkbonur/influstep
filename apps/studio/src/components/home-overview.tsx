import { api } from '@influstep/convex/_generated/api'
import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { PersonaAvatar } from './persona-avatar'
import { StatusPill } from './status'
import { Eyebrow, Mono, Skeleton } from './ui'
import { formatMoney, plural, relativeTime } from '@/lib/format'

type Overview = FunctionReturnType<typeof api.private.home.overview>

const ROW_LINK = 'underline decoration-fog underline-offset-2 hover:decoration-ink'

/**
 * The home overview (DESIGN.md, Calendar): the operator's three questions in
 * one glance, above the week. Three plain columns between mist rules, never
 * cards: what waits on them, what the personas changed on their own this
 * week, and what each earned over the report's window.
 */
export function HomeOverview() {
  const overview = useQuery(api.private.home.overview, {})
  if (overview === undefined) return <Skeleton className="mb-8 h-36" />
  return (
    <section
      aria-label="This week at a glance"
      className="mb-8 grid gap-6 border-y border-mist py-4 lg:grid-cols-3 lg:gap-0 lg:divide-x lg:divide-mist"
    >
      <Waits waits={overview.waits} />
      <Changes changes={overview.changes} />
      <Earned earned={overview.earned} />
    </section>
  )
}

function Column(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-sm lg:px-5 lg:first:pl-0 lg:last:pr-0">
      <Eyebrow className="mb-2">{props.title}</Eyebrow>
      {props.children}
    </div>
  )
}

function Waits(props: { waits: Overview['waits'] }) {
  const { waits } = props
  const nothing = waits.episodeCount === 0 && waits.checklist === 0 && waits.replies.length === 0
  return (
    <Column title="Waits on you">
      {nothing && <p className="text-ash">Nothing. The personas are working on their own.</p>}
      <ul className="space-y-1.5">
        {waits.episodes.map((episode) => (
          <li key={episode._id} className="flex min-w-0 items-center gap-2">
            <StatusPill status={episode.status} />
            <Link to="/episodes/$episodeId" params={{ episodeId: episode._id }} className="truncate hover:underline">
              {episode.title}
            </Link>
            <span className="shrink-0 text-xs text-ash">{episode.persona.name}</span>
          </li>
        ))}
        {waits.episodeCount > waits.episodes.length && (
          <li className="text-xs text-ash">and {waits.episodeCount - waits.episodes.length} more on the calendar</li>
        )}
        {waits.checklist > 0 && (
          <li>
            <Link to="/checklist" className={ROW_LINK}>
              <Mono>{waits.checklist}</Mono> {plural(waits.checklist, 'checklist item', 'checklist items')}
            </Link>
          </li>
        )}
        {waits.replies.map((row) => (
          <li key={row.persona._id}>
            <Link to="/personas/$personaId/replies" params={{ personaId: row.persona._id }} className={ROW_LINK}>
              <Mono>{row.drafts}</Mono> {plural(row.drafts, 'reply', 'replies')} to post
            </Link>{' '}
            <span className="text-xs text-ash">for {row.persona.name}</span>
          </li>
        ))}
      </ul>
    </Column>
  )
}

function Changes(props: { changes: Overview['changes'] }) {
  const { changes } = props
  return (
    <Column title="Changed on their own this week">
      {changes.count === 0 && <p className="text-ash">Nothing yet. Each persona reviews its strategy on Mondays.</p>}
      <ul className="space-y-2">
        {changes.entries.map((entry) => (
          <li key={entry._id} className="min-w-0">
            <Link to="/personas/$personaId/strategy" params={{ personaId: entry.persona._id }} className="line-clamp-2 hover:underline">
              <span className="font-medium">{entry.persona.name}:</span> {entry.text}
            </Link>
            <span className="text-xs text-ash">
              {relativeTime(entry.createdAt)} · by the {entry.actor}
            </span>
          </li>
        ))}
        {changes.count > changes.entries.length && (
          <li className="text-xs text-ash">and {changes.count - changes.entries.length} more in the personas' journals</li>
        )}
      </ul>
    </Column>
  )
}

function Earned(props: { earned: Overview['earned'] }) {
  const { earned } = props
  const currency = earned.currency
  return (
    <Column title={`Earned, last ${earned.days} days`}>
      {currency === null && <p className="text-ash">No persona yet.</p>}
      {currency !== null && (
        <>
          <ul className="space-y-1.5">
            {earned.personas.map((row) => (
              <li key={row.persona._id} className="tabular grid grid-cols-[auto_1fr_auto] items-center gap-2">
                <PersonaAvatar color={row.persona.color} state="idle" size={20} />
                <Link to="/reports/$personaId" params={{ personaId: row.persona._id }} className="truncate hover:underline">
                  {row.persona.name}
                </Link>
                <span className={row.value === 0 ? 'text-ash' : undefined}>
                  {formatMoney(row.value, currency)}
                  <span className="ml-2 text-xs text-ash">{row.paid} paid</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ash">
            Estimated: paid conversions times the value of one, first touch, and short of visitors who declined cookies.{' '}
            {earned.mock && 'Mock numbers. '}
            <Link to="/reports" className={ROW_LINK}>
              Reports
            </Link>
          </p>
        </>
      )}
    </Column>
  )
}
