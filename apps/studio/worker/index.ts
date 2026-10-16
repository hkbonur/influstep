/// <reference types="@cloudflare/workers-types" />
/**
 * The studio's Cloudflare Worker: serves the SPA, counts tracked-link clicks
 * on /go/:slug and redirects (ADR 0003), and renders the link-in-bio page on
 * /p/:handle. Both call the backend's public functions over HTTP.
 */
import { ConvexHttpClient } from 'convex/browser'
import { api } from '@influstep/convex/_generated/api'
import { isPlatform, trackedLinkPath, type Platform } from '@influstep/shared'

interface Env {
  ASSETS: Fetcher
  CONVEX_URL: string
}

export function bioPage(bio: {
  name: string
  handle: string
  bio: string
  sponsorName: string
  sponsorSlug: string | null
  episodes: { title: string; platform: string; url: string }[]
  /** The platform whose bio linked here; its sponsor link carries it on, so the click counts for that platform. */
  via?: Platform
}): string {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const sponsorHref = bio.sponsorSlug && trackedLinkPath(bio.sponsorSlug, bio.via)
  const sponsor = sponsorHref
    ? `<a class="sponsor" href="${escape(sponsorHref)}">${escape(bio.sponsorName)}: the forms my workflows send</a>`
    : ''
  const episodes = bio.episodes
    .map(
      (episode) =>
        `<li><a href="${escape(episode.url)}" rel="noopener">${escape(episode.title)}<span>${escape(episode.platform)}</span></a></li>`
    )
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>@${escape(bio.handle)}</title>
<style>
body{margin:0;background:#fafafa;color:#262626;font-family:Inter,system-ui,sans-serif;line-height:1.5}
main{max-width:36rem;margin:0 auto;padding:3rem 1rem}
h1{font-size:1.5rem;letter-spacing:-.02em;margin:0}
.handle{font-family:ui-monospace,monospace;color:#737373;font-size:.8125rem}
p{margin:.75rem 0 1.5rem}
.sponsor{display:block;background:#262626;color:#fafafa;text-decoration:none;padding:.75rem 1rem;border-radius:.625rem;font-weight:500}
ul{list-style:none;padding:0;margin:1.5rem 0 0}
li a{display:flex;justify-content:space-between;gap:1rem;padding:.75rem 0;border-top:1px solid #e5e5e5;color:inherit;text-decoration:none}
li span{font-family:ui-monospace,monospace;color:#737373;font-size:.8125rem}
small{display:block;margin-top:2rem;color:#737373;font-size:.75rem}
</style></head><body><main>
<h1>${escape(bio.name)}</h1><div class="handle">@${escape(bio.handle)}</div><p>${escape(bio.bio)}</p>
${sponsor}<ul>${episodes}</ul>
<small>${escape(bio.name)} is an AI-generated presenter.</small>
</main></body></html>`
}

/**
 * The platform a viewer's URL names in `via`. Anyone can edit a URL, so a
 * value that names no platform is not passed on: the page and the redirect
 * still work, and the click counts as the bio's without a platform.
 */
function viaOf(url: URL): Platform | undefined {
  const via = url.searchParams.get('via')
  return via !== null && isPlatform(via) ? via : undefined
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const go = url.pathname.match(/^\/go\/([a-z0-9-]+)\/?$/)
    if (go?.[1]) {
      const client = new ConvexHttpClient(env.CONVEX_URL)
      const result = await client.mutation(api.public.links.click, {
        slug: go[1],
        via: viaOf(url),
        referrer: request.headers.get('referer') ?? undefined,
        country: request.headers.get('cf-ipcountry') ?? undefined,
      })
      if (!result) return new Response('This link does not exist.', { status: 404 })
      return Response.redirect(result.target, 302)
    }
    const bio = url.pathname.match(/^\/p\/([a-z0-9._-]+)\/?$/)
    if (bio?.[1]) {
      const client = new ConvexHttpClient(env.CONVEX_URL)
      const page = await client.query(api.public.links.bio, { handle: bio[1] })
      if (!page) return new Response('No such persona.', { status: 404 })
      return new Response(bioPage({ ...page, via: viaOf(url) }), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
      })
    }
    return env.ASSETS.fetch(request)
  },
}
