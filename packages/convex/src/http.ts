import { httpRouter } from 'convex/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { httpAction, type ActionCtx } from './_generated/server'
import { runnerToken } from './lib/env'

/**
 * The runner's door into the backend (ADR 0001). Every route needs the shared
 * RUNNER_TOKEN as a bearer token. The studio app and the worker use Convex
 * functions directly, not these routes.
 */

const http = httpRouter()

function unauthorized(): Response {
  return Response.json({ error: 'runner token missing or wrong' }, { status: 401 })
}

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? ''
  return header === `Bearer ${runnerToken()}`
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json()
  if (typeof body !== 'object' || body === null) throw new Error('body must be a JSON object')
  return body as Record<string, unknown>
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`"${key}" must be a non-empty string`)
  return value
}

/** A key the body may leave out or set to null; when present it is a non-empty string. */
function optionalString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length === 0) throw new Error(`"${key}" must be a non-empty string or null`)
  return value
}

function route(handler: (ctx: ActionCtx, body: Record<string, unknown>) => Promise<unknown>) {
  return httpAction(async (ctx, request) => {
    if (!authorized(request)) return unauthorized()
    try {
      const body = request.method === 'POST' ? await readJson(request) : {}
      const result = await handler(ctx, body)
      return Response.json(result ?? null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Response.json({ error: message }, { status: 400 })
    }
  })
}

http.route({
  path: '/runner/heartbeat',
  method: 'POST',
  handler: route(async (ctx, body) => {
    await ctx.runMutation(internal.internal.runner.heartbeat, {
      name: requireString(body, 'name'),
      version: requireString(body, 'version'),
      providersMode: requireString(body, 'providersMode'),
      jobId: optionalString(body, 'jobId') as Id<'jobs'> | null,
    })
    return { ok: true }
  }),
})

http.route({
  path: '/runner/claim',
  method: 'POST',
  handler: route(async (ctx, body) => {
    const job = await ctx.runMutation(internal.internal.runner.claimNext, { runnerName: requireString(body, 'name') })
    return { job }
  }),
})

http.route({
  path: '/runner/complete',
  method: 'POST',
  handler: route(async (ctx, body) => {
    await ctx.runMutation(internal.internal.runner.complete, { jobId: requireString(body, 'jobId') as Id<'jobs'>, result: body.result })
    return { ok: true }
  }),
})

http.route({
  path: '/runner/fail',
  method: 'POST',
  handler: route(async (ctx, body) => {
    await ctx.runMutation(internal.internal.runner.fail, {
      jobId: requireString(body, 'jobId') as Id<'jobs'>,
      error: requireString(body, 'error'),
    })
    return { ok: true }
  }),
})

http.route({
  path: '/runner/upload-url',
  method: 'POST',
  handler: route(async (ctx) => ({ uploadUrl: await ctx.storage.generateUploadUrl() })),
})

export default http
