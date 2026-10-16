import { backend } from './backend'
import { config, providersMode } from './config'
import { failureOf } from './failure'
import { produce } from './produce'
import { postReply, publish } from './publish'
import { openBrowser } from './record'
import { designVoice } from './voice'

/**
 * The runner (CONTEXT.md): polls the backend for runner jobs and does the
 * work that needs this machine. One job at a time; a failure is reported,
 * never retried silently.
 */

const CLAIM_EVERY_MS = 5_000
const HEARTBEAT_EVERY_MS = 30_000

// The job this process is on, reported with every heartbeat; a job nobody reports goes back to the queue.
let currentJobId: string | null = null

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`)
}

async function handle(job: NonNullable<Awaited<ReturnType<typeof backend.claim>>>): Promise<void> {
  log(`job ${job.id}: ${job.kind}`)
  currentJobId = job.id
  try {
    if (job.kind === 'produce') {
      const result = await produce(job)
      await backend.complete(job.id, result)
    } else if (job.kind === 'publish') {
      const result = await publish(job)
      await backend.complete(job.id, result)
    } else if (job.kind === 'post_reply') {
      const result = await postReply(job)
      await backend.complete(job.id, result)
    } else if (job.kind === 'design_voice') {
      await backend.complete(job.id, await designVoice(job.payload))
    } else {
      await openBrowser(job.payload.url)
      await backend.complete(job.id, { opened: job.payload.url })
    }
    log(`job ${job.id}: done`)
  } catch (error) {
    const failure = failureOf(error)
    const at = failure.shotId === undefined ? '' : ` at ${failure.shotId}`
    log(`job ${job.id}: failed${at}: ${failure.error}`)
    // The backend refuses a job that went back to the queue or that another process finished; the loop goes on.
    await backend
      .fail(job.id, failure)
      .catch((error: unknown) => log(`job ${job.id}: fail refused: ${error instanceof Error ? error.message : String(error)}`))
  } finally {
    currentJobId = null
  }
}

async function main(): Promise<void> {
  log(`runner "${config.name()}" v${config.version}, providers ${providersMode()}, backend ${config.siteUrl()}`)
  await backend.heartbeat(null)
  setInterval(
    () => backend.heartbeat(currentJobId).catch((error: unknown) => log(`heartbeat failed: ${String(error)}`)),
    HEARTBEAT_EVERY_MS
  )
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
