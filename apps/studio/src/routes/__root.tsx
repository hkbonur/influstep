import { api } from '@influstep/convex/_generated/api'
import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import React from 'react'
import { cn } from '@/lib/cn'

const NAV = [
  { to: '/', label: 'Calendar' },
  { to: '/personas', label: 'Personas' },
  { to: '/experiments', label: 'Experiments' },
  { to: '/signals', label: 'Signals' },
  { to: '/checklist', label: 'Checklist' },
  { to: '/reports', label: 'Reports' },
  { to: '/providers', label: 'Providers' },
] as const

function Sidebar(props: { collapsed: boolean; onToggle: () => void }) {
  const checklist = useQuery(api.private.checklist.list, {})
  const providers = useQuery(api.private.providers.status, {})
  const open = checklist?.filter((item) => item.status === 'open').length ?? 0
  const runnerAlive = providers?.runner?.alive ?? false
  return (
    <aside
      className={cn('flex h-dvh shrink-0 flex-col border-r border-mist bg-paper-tint transition-[width] duration-200 ease-out-quint', {
        'w-[232px]': !props.collapsed,
        'w-14': props.collapsed,
      })}
    >
      <div className="flex h-14 items-center gap-2 px-3">
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
      <nav className="flex flex-col gap-0.5 px-2">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === '/' }}
            className="flex h-8 items-center justify-between rounded-lg px-2.5 text-sm text-graphite hover:bg-hairline-strong"
            activeProps={{ className: 'bg-hairline-strong text-ink font-medium' }}
            title={props.collapsed ? item.label : undefined}
          >
            <span className={cn({ 'sr-only': props.collapsed })}>{item.label}</span>
            {props.collapsed && <span className="font-mono text-[11px]">{item.label.slice(0, 2)}</span>}
            {item.to === '/checklist' && open > 0 && !props.collapsed && (
              <span className="tabular rounded-full bg-alert-amber/20 px-1.5 font-mono text-[11px] text-alert-amber-deep">{open}</span>
            )}
          </Link>
        ))}
      </nav>
      <div className="mt-auto px-4 py-4 text-xs text-ash">
        {!props.collapsed && (
          <div className="flex items-center gap-2">
            <span aria-hidden className={cn('size-1.5 rounded-full', { 'bg-field-green': runnerAlive, 'bg-fog': !runnerAlive })} />
            {runnerAlive ? 'Runner online' : 'Runner offline'}
            {providers && <span className="ml-auto font-mono">{providers.mode}</span>}
          </div>
        )}
      </div>
    </aside>
  )
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
      <main className="min-w-0 flex-1 overflow-y-auto">
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
