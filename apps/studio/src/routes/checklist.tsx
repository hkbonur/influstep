import { api } from '@influstep/convex/_generated/api'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { Button, Empty, ErrorLine, Eyebrow, ExternalLinkButton, LinkButton, Mono, PageHeader, Skeleton } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'

export const Route = createFileRoute('/checklist')({ component: ChecklistPage })

type Item = NonNullable<ReturnType<typeof useQuery<typeof api.private.checklist.list>>>[number]

function ChecklistPage() {
  const items = useQuery(api.private.checklist.list, {})
  const open = items?.filter((item) => item.status === 'open') ?? []
  const done = items?.filter((item) => item.status === 'done') ?? []
  return (
    <>
      <PageHeader title="Checklist" lead="What only you can do. Ticking an item resumes the episode it blocks." />
      {!items && <Skeleton className="h-40" />}
      {items && open.length === 0 && (
        <Empty>Nothing waits on you. The agents will add an item here when they hit a sign-in or a missing key.</Empty>
      )}
      <ul className="divide-y divide-mist border-y border-mist">
        {open.map((item) => (
          <ChecklistRow key={item._id} item={item} />
        ))}
      </ul>
      {done.length > 0 && (
        <section className="mt-10">
          <Eyebrow className="mb-2">Done</Eyebrow>
          <ul className="divide-y divide-mist border-y border-mist text-sm text-ash">
            {done.map((item) => (
              <li key={item._id} className="flex items-center gap-3 py-2">
                <span className="line-through">{item.title}</span>
                <Mono className="text-xs">@{item.personaHandle}</Mono>
                <span className="ml-auto text-xs">{item.doneAt ? formatDateTime(item.doneAt) : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function ChecklistRow(props: { item: Item }) {
  const complete = useMutation(api.private.checklist.complete)
  const runAction = useMutation(api.private.checklist.runAction)
  const [error, setError] = React.useState<string | null>(null)
  const [queued, setQueued] = React.useState(false)
  const act = async () => {
    setError(null)
    try {
      await runAction({ itemId: props.item._id })
      setQueued(true)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }
  const { item } = props
  return (
    <li className="flex items-start gap-3 py-3">
      <input
        type="checkbox"
        className="mt-1 size-4 accent-ink"
        aria-label={`Done: ${item.title}`}
        onChange={() => complete({ itemId: item._id })}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{item.title}</p>
        <p className="text-ash">{item.why}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-ash">
          <Link to="/personas/$personaId" params={{ personaId: item.personaId }} className="hover:underline">
            @{item.personaHandle}
          </Link>
          {item.episodeId && item.episodeTitle && (
            <Link to="/episodes/$episodeId" params={{ episodeId: item.episodeId }} className="hover:underline">
              unblocks: {item.episodeTitle}
            </Link>
          )}
          <span>{formatDateTime(item.createdAt)}</span>
        </p>
        {error && (
          <div className="mt-2">
            <ErrorLine>{error}</ErrorLine>
          </div>
        )}
      </div>
      {item.action?.kind === 'open_browser' && (
        <div className="flex flex-col items-end gap-1">
          <Button size="sm" onClick={act} disabled={queued}>
            {queued ? 'Browser opening on the runner' : 'Open browser'}
          </Button>
          <span className="font-mono text-[11px] text-ash">{item.action.url}</span>
        </div>
      )}
      {item.action?.kind === 'set_provider_key' && (
        <LinkButton to="/providers" size="sm">
          Set {item.action.key}
        </LinkButton>
      )}
      {/* A page the operator reads and acts on by hand; the runner never opens it. */}
      {item.action?.kind === 'visit' && (
        <ExternalLinkButton href={item.action.url} size="sm">
          Open
        </ExternalLinkButton>
      )}
    </li>
  )
}
