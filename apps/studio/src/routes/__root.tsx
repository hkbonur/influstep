import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import {
  BroadcastIcon,
  CalendarBlankIcon,
  ChartLineIcon,
  FlaskIcon,
  ListChecksIcon,
  PlugsIcon,
  PlusIcon,
  RobotIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react'
import { Link, Outlet, createRootRoute, useMatchRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { PersonaAvatar, personaAvatarState } from '@/components/persona-avatar'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useRunnerOnline } from '@/lib/use-runner-online'

// `exact`: a persona's own page, its voice, its strategy and its report light up the persona's row instead, so the section
// stays dark there and the sidebar never shows two selections at once. Search params never count, so the open new persona
// form on /personas?new=true still lights Personas.
const NAV = [
  { to: '/', label: 'Calendar', icon: CalendarBlankIcon, exact: true },
  { to: '/personas', label: 'Personas', icon: UsersThreeIcon, exact: true },
  { to: '/agents', label: 'Agents', icon: RobotIcon, exact: false },
  { to: '/experiments', label: 'Experiments', icon: FlaskIcon, exact: false },
  { to: '/signals', label: 'Signals', icon: BroadcastIcon, exact: false },
  { to: '/checklist', label: 'Checklist', icon: ListChecksIcon, exact: false },
  { to: '/reports', label: 'Reports', icon: ChartLineIcon, exact: true },
  { to: '/providers', label: 'Providers', icon: PlugsIcon, exact: false },
] as const

type PersonaRow = FunctionReturnType<typeof api.private.personas.list>[number]

/** The one mark a roster row may carry: what waits on the operator first, then a failure, else nothing. */
type PersonaMark = { kind: 'waiting'; count: number } | { kind: 'failed' } | { kind: 'none' }

function Sidebar(props: { collapsed: boolean; onToggle: () => void }) {
  const checklist = useQuery(api.private.checklist.list, {})
  const providers = useQuery(api.private.providers.status, {})
  const open = checklist?.filter((item) => item.status === 'open').length ?? 0
  const runnerOnline = useRunnerOnline(providers?.runner?.lastSeenAt ?? null)
  const runnerStatus = runnerOnline ? 'Runner online' : 'Runner offline'
  const runnerLabel = providers ? `${runnerStatus}, ${providers.mode}` : runnerStatus
  return (
    // Sticky rather than a scroll container of its own: the page keeps window scroll, which the router resets on navigation.
    <aside
      className={cn(
        'sticky top-0 flex h-dvh shrink-0 flex-col self-start border-r border-mist bg-paper-tint transition-[width] duration-200 ease-out-quint',
        {
          'w-[232px]': !props.collapsed,
          'w-14': props.collapsed,
        }
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          onClick={props.onToggle}
          className="flex size-8 items-center justify-center rounded-lg hover:bg-hairline-strong"
          aria-label={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span aria-hidden className="flex size-4 items-center justify-center rounded-[5px] bg-ink">
            <span className="size-1.5 rounded-full bg-field-green" />
          </span>
        </button>
        {!props.collapsed && <span className="font-semibold tracking-tight">Influstep</span>}
      </div>
      <nav className="flex shrink-0 flex-col gap-0.5 px-2">
        {NAV.map((item) => (
          <NavItem key={item.to} item={item} count={item.to === '/checklist' ? open : 0} collapsed={props.collapsed} />
        ))}
      </nav>
      <PersonaRoster collapsed={props.collapsed} />
      <div className="shrink-0 px-4 py-4 text-xs text-ash">
        {/* The rail keeps the dot alone, named for hover and screen readers: an offline runner stalls every persona. */}
        <div
          className={cn('flex items-center gap-2', { 'justify-center': props.collapsed })}
          title={props.collapsed ? runnerLabel : undefined}
          role={props.collapsed ? 'img' : undefined}
          aria-label={props.collapsed ? runnerLabel : undefined}
        >
          <span aria-hidden className={cn('size-1.5 rounded-full', { 'bg-field-green': runnerOnline, 'bg-fog': !runnerOnline })} />
          {!props.collapsed && runnerStatus}
          {!props.collapsed && providers && <span className="ml-auto font-mono">{providers.mode}</span>}
        </div>
      </div>
    </aside>
  )
}

/** A nav entry: icon and name when open, the icon alone on the rail, where an open count shrinks to an amber dot. */
function NavItem(props: { item: (typeof NAV)[number]; count: number; collapsed: boolean }) {
  const ItemIcon = props.item.icon
  const name = props.count > 0 ? `${props.item.label}, ${props.count} open` : props.item.label
  return (
    <Link
      to={props.item.to}
      activeOptions={{ exact: props.item.exact, includeSearch: false }}
      className={cn('flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm text-graphite hover:bg-hairline-strong', {
        'justify-center px-0': props.collapsed,
      })}
      activeProps={{ className: 'bg-hairline-strong text-ink font-medium' }}
      title={props.collapsed ? name : undefined}
      aria-label={props.collapsed ? name : undefined}
    >
      {(state) => (
        <>
          <span className="relative flex shrink-0">
            <ItemIcon size={16} weight={state.isActive ? 'fill' : 'regular'} aria-hidden />
            {props.collapsed && props.count > 0 && (
              <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-alert-amber ring-2 ring-paper" />
            )}
          </span>
          {!props.collapsed && <span className="truncate">{props.item.label}</span>}
          {!props.collapsed && props.count > 0 && (
            <span className="tabular ml-auto rounded-full bg-alert-amber/20 px-1.5 font-mono text-[11px] text-graphite">{props.count}</span>
          )}
        </>
      )}
    </Link>
  )
}

/** Every persona as a row, oldest first, so the one the operator talks to is one click from any page. */
function PersonaRoster(props: { collapsed: boolean }) {
  const personas = useQuery(api.private.personas.list, {})
  const selectedPersonaId = useSelectedPersonaId()
  const headingId = React.useId()
  return (
    <section aria-labelledby={headingId} className="mt-5 flex min-h-0 flex-1 flex-col">
      {props.collapsed && <div aria-hidden className="mx-auto mb-2 h-px w-6 shrink-0 bg-mist" />}
      <div
        className={cn('flex h-7 shrink-0 items-center justify-between pr-2 pl-4.5', {
          'justify-center px-0': props.collapsed,
        })}
      >
        <h2 id={headingId} className={cn('eyebrow', { 'sr-only': props.collapsed })}>
          Personas
        </h2>
        <Link
          to="/personas"
          search={{ new: true }}
          // Exact, so the + is not announced as the current page on every persona page.
          activeOptions={{ exact: true }}
          aria-label="New persona"
          title="New persona"
          className="flex size-6 items-center justify-center rounded-md text-ash hover:bg-hairline-strong hover:text-ink"
        >
          <PlusIcon size={14} aria-hidden />
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
        <RosterBody personas={personas} selectedPersonaId={selectedPersonaId} collapsed={props.collapsed} />
      </div>
    </section>
  )
}

function RosterBody(props: { personas: PersonaRow[] | undefined; selectedPersonaId: string | null; collapsed: boolean }) {
  if (props.personas === undefined) return <RosterSkeleton collapsed={props.collapsed} />
  if (props.personas.length === 0) {
    // The rail has no room for the sentence; its + button already leads to the form.
    if (props.collapsed) return null
    return (
      <Link
        to="/personas"
        search={{ new: true }}
        activeOptions={{ exact: true }}
        className="block rounded-lg px-2 py-1.5 text-ash hover:bg-paper-warm hover:text-ink"
      >
        No persona yet.
      </Link>
    )
  }
  return (
    <ul className={cn('flex flex-col gap-0.5', { 'items-center': props.collapsed })}>
      {props.personas.map((persona) => (
        <li key={persona._id} className={cn({ 'w-full': !props.collapsed })}>
          <PersonaLink persona={persona} selected={persona._id === props.selectedPersonaId} collapsed={props.collapsed} />
        </li>
      ))}
    </ul>
  )
}

function PersonaLink(props: { persona: PersonaRow; selected: boolean; collapsed: boolean }) {
  const mark = personaMark(props.persona)
  const summary = personaSummary(props.persona, mark)
  return (
    <Link
      to="/personas/$personaId"
      params={{ personaId: props.persona._id }}
      title={summary}
      aria-label={summary}
      // Its voice, its strategy, its report and its episodes select the row too; the router marks the persona page itself as "page".
      aria-current={props.selected ? 'true' : undefined}
      className={cn('flex items-center rounded-lg hover:bg-paper-warm', {
        'h-9 gap-2.5 pr-2 pl-1': !props.collapsed,
        'size-9 justify-center': props.collapsed,
        'bg-paper-warm': props.selected,
      })}
    >
      <span className="relative flex shrink-0">
        <PersonaAvatar
          color={props.persona.color}
          state={personaAvatarState(props.persona)}
          size={28}
          // tailwind-merge lets fog replace the persona hue: a paused persona reads as switched off.
          className={cn({ 'text-fog': props.persona.paused })}
        />
        {props.collapsed && <CornerDot mark={mark} />}
      </span>
      {!props.collapsed && (
        <span
          className={cn('min-w-0 flex-1 truncate font-medium', {
            'text-ash': props.persona.paused,
            'text-ink': props.selected && !props.persona.paused,
            'text-graphite': !props.selected && !props.persona.paused,
          })}
        >
          {props.persona.name}
        </span>
      )}
      {!props.collapsed && <RowMark mark={mark} />}
    </Link>
  )
}

function RowMark(props: { mark: PersonaMark }) {
  if (props.mark.kind === 'waiting') {
    return (
      <span aria-hidden className="tabular shrink-0 rounded-full bg-alert-amber/20 px-1.5 font-mono text-[11px] text-graphite">
        {props.mark.count}
      </span>
    )
  }
  if (props.mark.kind === 'failed') return <span aria-hidden className="mx-1 size-1.5 shrink-0 rounded-full bg-signal-red" />
  return null
}

/** The rail's version of the mark: a dot on the avatar's top-right corner, ringed so it reads against any avatar color. */
function CornerDot(props: { mark: PersonaMark }) {
  if (props.mark.kind === 'none') return null
  return (
    <span
      aria-hidden
      className={cn('absolute -top-px -right-px size-2 rounded-full ring-2 ring-paper', {
        'bg-alert-amber': props.mark.kind === 'waiting',
        'bg-signal-red': props.mark.kind === 'failed',
      })}
    />
  )
}

function RosterSkeleton(props: { collapsed: boolean }) {
  return (
    <ul aria-hidden className={cn('flex flex-col gap-0.5', { 'items-center': props.collapsed })}>
      {['w-24', 'w-20', 'w-28'].map((width) => (
        <li
          key={width}
          className={cn('flex items-center gap-2.5', { 'h-9 pl-1': !props.collapsed, 'size-9 justify-center': props.collapsed })}
        >
          <span className="size-7 shrink-0 rounded-full bg-fog" />
          {!props.collapsed && <Skeleton className={cn('h-3', width)} />}
        </li>
      ))}
    </ul>
  )
}

/**
 * What waits on the operator, each thing once: open checklist items, and the
 * episodes the shared waitsOnOperator rule names (a script or a publish
 * package to approve), an episode held by a sign-in counted through its
 * checklist item. Failed has its own mark, the red dot.
 */
function personaMark(persona: PersonaRow): PersonaMark {
  const waiting = persona.counts.waitingTotal
  if (waiting > 0) return { kind: 'waiting', count: waiting }
  if (persona.counts.failed > 0) return { kind: 'failed' }
  return { kind: 'none' }
}

/**
 * The row's tooltip and accessible name. It replaces the row's content for
 * screen readers, so "paused" is always there, never only in the dimmed
 * avatar. Then the mark, which is what the operator acts on; "working" only
 * when there is no mark and the avatar shows the thinking dots.
 */
function personaSummary(persona: PersonaRow, mark: PersonaMark): string {
  const parts = [persona.name]
  if (persona.paused) parts.push('paused')
  if (mark.kind === 'waiting') parts.push(`${mark.count} waiting on you`)
  if (mark.kind === 'failed') parts.push('failed episode')
  if (mark.kind === 'none' && personaAvatarState(persona) === 'thinking') parts.push('working')
  return parts.join(', ')
}

/**
 * The persona the current page belongs to: its own page, its voice, its
 * strategy, its report, or one of its episodes. An episode route names only the episode, so
 * its persona comes from the episode itself.
 */
function useSelectedPersonaId(): string | null {
  const matchRoute = useMatchRoute()
  const personaPage = matchRoute({ to: '/personas/$personaId' })
  // Their own matches: route matching is exact by default, so the persona page's match never covers /voice or /strategy.
  const voicePage = matchRoute({ to: '/personas/$personaId/voice' })
  const strategyPage = matchRoute({ to: '/personas/$personaId/strategy' })
  const reportPage = matchRoute({ to: '/reports/$personaId' })
  const episodePage = matchRoute({ to: '/episodes/$episodeId' })
  const episode = useQuery(api.private.episodes.get, episodePage ? { episodeId: episodePage.episodeId as Id<'episodes'> } : 'skip')
  if (personaPage) return personaPage.personaId
  if (voicePage) return voicePage.personaId
  if (strategyPage) return strategyPage.personaId
  if (reportPage) return reportPage.personaId
  // Undefined while the episode loads, null when it does not exist: no row is selected in either case.
  if (episode) return episode.episode.personaId
  return null
}

function RootComponent() {
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem('sidebar') === 'collapsed'
    } catch {
      return false
    }
  })
  const toggle = () => {
    setCollapsed((current) => {
      try {
        localStorage.setItem('sidebar', current ? 'open' : 'collapsed')
      } catch {
        // Private mode: the preference lives for this tab only.
      }
      return !current
    })
  }
  return (
    <div className="flex min-h-dvh bg-paper">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function NotFound() {
  return (
    <div className="py-20 text-center text-ash">
      <p>There is nothing at this address.</p>
      <Link to="/" className="mt-2 inline-block underline">
        Back to the calendar
      </Link>
    </div>
  )
}

export const Route = createRootRoute({ component: RootComponent, notFoundComponent: NotFound })
