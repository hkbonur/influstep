import { api } from '@influstep/convex/_generated/api'
import { PLATFORMS } from '@influstep/shared'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import React from 'react'
import { z } from 'zod'

/**
 * Dev-only twin of the worker's /go/:slug (ADR 0003): counts the click and
 * redirects. In production the worker answers before the SPA loads.
 */
// As in the worker, a `via` that names no platform is dropped, never an error: anyone can edit the URL.
const searchSchema = z.object({ via: z.enum(PLATFORMS).optional().catch(undefined) })

export const Route = createFileRoute('/go/$slug')({ component: GoPage, validateSearch: searchSchema })

function GoPage() {
  const params = Route.useParams()
  const { via } = Route.useSearch()
  const click = useMutation(api.public.links.click)
  const [missing, setMissing] = React.useState(false)
  // StrictMode mounts twice in dev; count the click once.
  const counted = React.useRef(false)
  React.useEffect(() => {
    if (counted.current) return
    counted.current = true
    void click({ slug: params.slug, via, referrer: document.referrer || undefined }).then((result) => {
      if (!result) {
        setMissing(true)
        return
      }
      window.location.replace(result.target)
    })
  }, [click, params.slug, via])
  return <p className="py-20 text-center text-ash">{missing ? 'This link does not exist.' : 'Counting the click…'}</p>
}
