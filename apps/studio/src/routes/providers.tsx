import { api } from '@influstep/convex/_generated/api'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Eyebrow, Mono, PageHeader, Pill, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'

export const Route = createFileRoute('/providers')({ component: ProvidersPage })

function ProvidersPage() {
  const status = useQuery(api.private.providers.status, {})
  const retry = useMutation(api.private.jobs.retry)
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
              Keys live in the Convex deployment's environment (backend) and in apps/runner/.env.local (voice, avatar, uploads). Voice,
              avatar and the publishers run on the runner, so the backend cannot see their keys.
            </p>
          </section>
        </div>

        <div className="space-y-10">
          <section>
            <Eyebrow className="mb-3">Runner</Eyebrow>
            {!runner && <p className="text-ash">No runner has checked in. Start one with pnpm --filter @influstep/runner dev.</p>}
            {runner && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-ash">Status</dt>
                <dd>
                  <Pill tint={runner.alive ? 'field-green' : 'signal-red'}>{runner.alive ? 'online' : 'offline'}</Pill>
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
