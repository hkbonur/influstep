import { api } from '@influstep/convex/_generated/api'
import { PLATFORM_LABELS } from '@influstep/shared'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { Mono, Skeleton } from '@/components/ui'

/** Dev-only twin of the worker's link-in-bio page on /p/:handle. */
export const Route = createFileRoute('/p/$handle')({ component: BioPage })

function BioPage() {
  const params = Route.useParams()
  const bio = useQuery(api.public.links.bio, { handle: params.handle })
  if (bio === undefined) return <Skeleton className="mx-auto h-40 max-w-xl" />
  if (bio === null) return <p className="py-20 text-center text-ash">No such persona.</p>
  return (
    <main className="mx-auto max-w-xl py-12">
      <h1 className="text-metric">{bio.name}</h1>
      <Mono className="text-ash">@{bio.handle}</Mono>
      <p className="my-3">{bio.bio}</p>
      {bio.sponsorSlug && (
        <a href={`/go/${bio.sponsorSlug}`} className="block rounded-lg bg-ink px-4 py-3 font-medium text-paper">
          {bio.sponsorName}: the forms my workflows send
        </a>
      )}
      <ul className="mt-6 divide-y divide-mist border-t border-mist">
        {bio.episodes.map((episode) => (
          <li key={episode.url}>
            <a href={episode.url} rel="noopener" className="flex justify-between gap-4 py-3 hover:underline">
              {episode.title}
              <Mono className="text-ash">{PLATFORM_LABELS[episode.platform]}</Mono>
            </a>
          </li>
        ))}
      </ul>
      <small className="mt-8 block text-xs text-ash">{bio.name} is an AI-generated presenter.</small>
    </main>
  )
}
