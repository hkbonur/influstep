import { api } from '@influstep/convex/_generated/api'
import { POLLED_SIGNAL_SOURCES, SIGNAL_SOURCE_LABELS } from '@influstep/shared'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { Button, ErrorLine, Eyebrow, Field, Input, Mono, PageHeader, Pill, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { relativeTime } from '@/lib/format'
import { useRunnerOnline } from '@/lib/use-runner-online'

export const Route = createFileRoute('/providers')({ component: ProvidersPage })

/** The sources the researcher polls, as one English list: the signal rows above are these, and only these. */
const POLLED_SOURCES = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(
  POLLED_SIGNAL_SOURCES.map((source) => SIGNAL_SOURCE_LABELS[source])
)

function ProvidersPage() {
  const status = useQuery(api.private.providers.status, {})
  const retry = useMutation(api.private.jobs.retry)
  const runnerOnline = useRunnerOnline(status?.runner?.lastSeenAt ?? null)
  if (!status) return <Skeleton className="h-96" />
  const { runner } = status
  return (
    <>
      <PageHeader
        title="Providers"
        lead={
          <>
            The backend runs in <Mono>{status.mode}</Mono> mode. Set <Mono>PROVIDERS_MODE=real</Mono> on the Convex deployment and the
            runner to switch; an adapter without a key fails loudly instead of pretending.
          </>
        }
      />
      <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-10">
          <section>
            <Eyebrow className="mb-3">Adapters</Eyebrow>
            <table className="w-full text-sm">
              <thead className="text-xs text-ash">
                <tr className="text-left">
                  <th className="w-44 py-1 font-medium">Provider</th>
                  <th className="w-56 py-1 font-medium">Real adapter</th>
                  <th className="py-1 font-medium">Needs</th>
                </tr>
              </thead>
              <tbody>
                {status.providers.map((provider) => {
                  const missing = provider.needs.filter((key) => !status.keys[key as keyof typeof status.keys])
                  return (
                    <tr key={provider.name} className="border-t border-mist">
                      <td className="py-1.5 whitespace-nowrap">
                        <Mono>{provider.name}</Mono>
                      </td>
                      <td className="py-1.5 whitespace-nowrap">
                        {provider.real}
                        {!provider.hasReal && <span className="ml-1 text-xs whitespace-nowrap text-ash">mock only</span>}
                      </td>
                      <td className="py-1.5">
                        <span className="flex flex-wrap gap-1">
                          {provider.needs.map((key) => (
                            <Pill key={key} tint={missing.includes(key) ? (status.mode === 'real' ? 'signal-red' : 'fog') : 'field-green'}>
                              {key}
                            </Pill>
                          ))}
                          {provider.needs.length === 0 && <span className="text-xs text-ash">no key</span>}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-ash">
              The researcher polls {POLLED_SOURCES}. Comments come from the publisher, which reads them on each platform, and problems from
              each persona's problem log.
            </p>
            <MediaBudgets />
            <p className="mt-1.5 text-xs text-ash">
              Keys live in the Convex deployment's environment (backend) and in apps/runner/.env.local (voice, avatar, uploads). Voice,
              avatar and the publishers run on the runner, so the backend cannot see their keys.
            </p>
          </section>
        </div>

        <div className="space-y-10">
          <section>
            <Eyebrow className="mb-3">Workspace</Eyebrow>
            <WorkspaceForm />
          </section>

          <section>
            <Eyebrow className="mb-3">Runner</Eyebrow>
            {!runner && <p className="text-ash">No runner has checked in. Start one with pnpm --filter @influstep/runner dev.</p>}
            {runner && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-ash">Status</dt>
                <dd>
                  <Pill tint={runnerOnline ? 'field-green' : 'signal-red'}>{runnerOnline ? 'online' : 'offline'}</Pill>
                </dd>
                <dt className="text-ash">Name</dt>
                <dd>
                  <Mono>{runner.name}</Mono> <span className="text-xs text-ash">v{runner.version}</span>
                </dd>
                <dt className="text-ash">Providers</dt>
                <dd>
                  <Mono>{runner.providersMode}</Mono>
                </dd>
                <dt className="text-ash">Last seen</dt>
                <dd>{relativeTime(runner.lastSeenAt)}</dd>
                <dt className="text-ash">Busy with</dt>
                <dd>{runner.currentJobId ? <Mono>{runner.currentJobId}</Mono> : 'nothing'}</dd>
              </dl>
            )}
          </section>

          <section>
            <Eyebrow className="mb-3">Recent jobs</Eyebrow>
            <ul className="space-y-1.5 font-mono text-[11px]">
              {status.recentJobs.map((job) => (
                <li key={job._id} className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden
                    className={cn('size-1.5 shrink-0 rounded-full', {
                      'bg-field-green': job.status === 'done',
                      'bg-signal-red': job.status === 'failed',
                      'bg-note-blue': job.status === 'running',
                      'bg-fog': job.status === 'queued',
                    })}
                  />
                  <span className="text-graphite">{job.kind}</span>
                  <span className="text-ash">
                    {job.runsOn} · {job.status}
                    {job.attempts > 1 && ` · attempt ${job.attempts}`}
                  </span>
                  <span className="ml-auto text-ash">{relativeTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}</span>
                  {job.status === 'failed' && (
                    <button type="button" className="text-ink hover:underline" onClick={() => retry({ jobId: job._id })}>
                      retry
                    </button>
                  )}
                  {job.error && <span className="basis-full truncate text-signal-red-deep">{job.error}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  )
}

const SAVED_FOR_MS = 2000

/** The form is in exactly one of these; "Saved" shows for a moment, then the form is idle again. */
type WorkspaceFormState = { status: 'idle' } | { status: 'saving' } | { status: 'saved' } | { status: 'error'; message: string }

/** The sponsor the personas promote and what one paid conversion is worth to it (the report's estimate). */
function WorkspaceForm() {
  const workspace = useQuery(api.private.workspace.get, {})
  const update = useMutation(api.private.workspace.update)
  const [state, setState] = React.useState<WorkspaceFormState>({ status: 'idle' })
  const savedTimer = React.useRef<number | null>(null)
  if (workspace === undefined) return <Skeleton className="h-40" />
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    setState({ status: 'saving' })
    try {
      await update({
        sponsorName: text('sponsorName'),
        sponsorUrl: text('sponsorUrl'),
        appUrl: text('appUrl'),
        valuePerPaid: Number(form.get('valuePerPaid')),
        currency: text('currency').toUpperCase(),
      })
      setState({ status: 'saved' })
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(
        () => setState((current) => (current.status === 'saved' ? { status: 'idle' } : current)),
        SAVED_FOR_MS
      )
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label="Sponsor name">
        <Input name="sponsorName" defaultValue={workspace.sponsorName} required />
      </Field>
      <Field label="Sponsor URL">
        <Input name="sponsorUrl" type="url" defaultValue={workspace.sponsorUrl} required />
      </Field>
      <Field label="App URL" hint="Where tracked links and link-in-bio pages live." className="sm:col-span-2">
        <Input name="appUrl" type="url" defaultValue={workspace.appUrl} required />
      </Field>
      <Field label="Value per paid conversion">
        <Input name="valuePerPaid" type="number" min={0} step="any" defaultValue={workspace.valuePerPaid} required />
      </Field>
      <Field label="Currency" hint="Three letters, like USD.">
        <Input name="currency" defaultValue={workspace.currency} minLength={3} maxLength={3} pattern="[A-Za-z]{3}" required />
      </Field>
      {state.status === 'error' && (
        <div className="sm:col-span-2">
          <ErrorLine>{state.message}</ErrorLine>
        </div>
      )}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="primary" busy={state.status === 'saving'}>
          Save
        </Button>
        {state.status === 'saved' && <span className="text-xs text-ash">Saved</span>}
      </div>
    </form>
  )
}

/**
 * The media provider's daily budget per persona (docs/plan.md, slice 15),
 * under the adapters: what each persona generated today against it. A job
 * that would pass it fails with the budget in its error.
 */
function MediaBudgets() {
  const budgets = useQuery(api.private.media.budgets, {})
  if (budgets === undefined) return null
  return (
    <div className="mt-3 text-xs text-ash">
      <p>
        Generated media: each persona may make <span className="tabular">{budgets.budget.images}</span> images and{' '}
        <span className="tabular">{budgets.budget.clipSeconds}</span> s of clips a day, in its own timezone.
      </p>
      {budgets.spend.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {budgets.spend.map((row) => (
            <li key={row.personaId}>
              {row.name}: <Mono>{row.images}</Mono> images, <Mono>{row.clipSeconds}</Mono> s of clips today
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
