import { backend } from './backend'
import { config, providersMode } from './config'
import { produce } from './produce'
import { publish } from './publish'
import { openBrowser } from './record'

/**
 * The runner (CONTEXT.md): polls the backend for runner jobs and does the
 * work that needs this machine. One job at a time; a failure is reported,
 * never retried silently.
 */

const CLAIM_EVERY_MS = 5_000
const HEARTBEAT_EVERY_MS = 30_000

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`)
}

async function handle(job: NonNullable<Awaited<ReturnType<typeof backend.claim>>>): Promise<void> {
  log(`job ${job.id}: ${job.kind}`)
  try {
    if (job.kind === 'produce') {
      const result = await produce(job)
      await backend.complete(job.id, result)
    } else if (job.kind === 'publish') {
      const result = await publish(job)
      await backend.complete(job.id, result)
    } else {
      await openBrowser(job.payload.url)
      await backend.complete(job.id, { opened: job.payload.url })
    }
    log(`job ${job.id}: done`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`job ${job.id}: failed: ${message}`)
    await backend.fail(job.id, message)
  }
}

async function main(): Promise<void> {
  log(`runner "${config.name()}" v${config.version}, providers ${providersMode()}, backend ${config.siteUrl()}`)
  await backend.heartbeat()
  setInterval(() => backend.heartbeat().catch((error: unknown) => log(`heartbeat failed: ${String(error)}`)), HEARTBEAT_EVERY_MS)
  for (;;) {
    let job: Awaited<ReturnType<typeof backend.claim>> = null
    try {
      job = await backend.claim()
    } catch (error) {
      log(`claim failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (job) await handle(job)
    else await new Promise((resolve) => setTimeout(resolve, CLAIM_EVERY_MS))
  }
}

await main()
