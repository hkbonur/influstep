import { api } from '@influstep/convex/_generated/api'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { Empty, Mono, PageHeader, Skeleton } from '@/components/ui'

export const Route = createFileRoute('/reports/')({ component: ReportsIndex })

function ReportsIndex() {
  const personas = useQuery(api.private.personas.list, {})
  return (
    <>
      <PageHeader title="Reports" lead="One page per persona: is it working?" />
      {!personas && <Skeleton className="h-24" />}
      {personas && personas.length === 0 && <Empty>No personas to report on.</Empty>}
      <ul className="divide-y divide-mist border-y border-mist">
        {personas?.map((persona) => (
          <li key={persona._id} className="py-3">
            <Link to="/reports/$personaId" params={{ personaId: persona._id }} className="font-medium hover:underline">
              {persona.name}
            </Link>{' '}
            <Mono className="text-ash">@{persona.handle}</Mono>
            <span className="tabular ml-3 text-xs text-ash">{persona.counts.published} published</span>
          </li>
        ))}
      </ul>
    </>
  )
}
