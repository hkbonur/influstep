import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import type { RecipeStep, Shot } from '@influstep/shared'
import { profileDir } from './config'
import { ShotRecordingError } from './failure'

export type ScreenShot = Extract<Shot, { kind: 'screen' }>

/**
 * Records one screen shot with Playwright's video recorder against the
 * runner's persistent browser profile, so tools the operator signed in to
 * (checklist item "Sign in to …") stay signed in. Returns the webm path.
 * A recipe step that fails throws a ShotRecordingError naming the shot: the
 * tool on screen broke. A browser that will not start, or a missing video,
 * is this machine's failure and stays a plain error.
 */
export async function recordScreen(args: { shot: ScreenShot; seconds: number; dir: string; headed: boolean }): Promise<string> {
  await fs.mkdir(args.dir, { recursive: true })
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !args.headed,
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: args.dir, size: { width: 1920, height: 1080 } },
  })
  try {
    const page = await context.newPage()
    const startedAt = Date.now()
    try {
      for (const step of args.shot.recipe) await runStep(page, step)
    } catch (error) {
      throw new ShotRecordingError(args.shot.id, error)
    }
    const left = args.seconds * 1000 - (Date.now() - startedAt)
    if (left > 0) await page.waitForTimeout(left)
    const video = page.video()
    await page.close()
    if (!video) throw new Error('Playwright recorded no video for the shot')
    return await video.path()
  } finally {
    await context.close()
  }
}

async function runStep(page: import('playwright').Page, step: RecipeStep): Promise<void> {
  if (step.step === 'goto') {
    await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    return
  }
  if (step.step === 'click') {
    await page.click(step.selector, { timeout: 15_000 })
    return
  }
  if (step.step === 'type') {
    await page.fill(step.selector, step.text, { timeout: 15_000 })
    return
  }
  if (step.step === 'wait') {
    await page.waitForTimeout(step.ms)
    return
  }
  await page.mouse.wheel(0, step.y)
}

/** Opens the runner's browser at a URL and waits until the operator closes it (checklist sign-ins). */
export async function openBrowser(url: string, maxMinutes = 15): Promise<void> {
  const context = await chromium.launchPersistentContext(profileDir, { headless: false, viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), maxMinutes * 60_000)
    context.on('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  await context.close().catch(() => {
    // Already closed by the operator.
  })
}

/**
 * A title card rendered by headless Chromium (ffmpeg builds often lack the
 * drawtext filter): paper background, the shot's title, the persona handle.
 */
export async function renderTitleCard(args: {
  title: string
  subtitle: string
  out: string
  width: number
  height: number
}): Promise<string> {
  await fs.mkdir(path.dirname(args.out), { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: args.width, height: args.height } })
    const fontSize = Math.round(args.width / 22)
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#fafafa;font-family:Inter,system-ui,sans-serif;color:#262626">
      <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(fontSize * 0.6)}px;padding:0 8%;text-align:center">
        <div style="font-size:${fontSize}px;font-weight:600;letter-spacing:-0.02em;line-height:1.15">${escapeHtml(args.title)}</div>
        <div style="font-size:${Math.round(fontSize * 0.42)}px;color:#737373;font-family:ui-monospace,monospace">${escapeHtml(args.subtitle)}</div>
      </div></body></html>`)
    await page.screenshot({ path: args.out, type: 'png' })
    return args.out
  } finally {
    await browser.close()
  }
}

/**
 * An image of the asset library fitted into the frame on the paper
 * background, drawn by headless Chromium: ffmpeg builds often decode no SVG
 * or WebP, and a browser decodes every image the library takes.
 */
export async function renderImageFrame(args: {
  image: string
  contentType: string
  out: string
  width: number
  height: number
}): Promise<string> {
  await fs.mkdir(path.dirname(args.out), { recursive: true })
  const source = `data:${args.contentType};base64,${(await fs.readFile(args.image)).toString('base64')}`
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: args.width, height: args.height } })
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#fafafa">
      <img src="${source}" style="display:block;width:100vw;height:100vh;object-fit:contain" alt=""></body></html>`)
    // decode() rejects when the browser cannot draw the file, so a broken image fails the job instead of rendering blank.
    await page
      .locator('img')
      .evaluate((image: HTMLImageElement) => image.decode())
      .catch((error: unknown) => {
        throw new Error(`the browser could not draw the image ${path.basename(args.image)} (${args.contentType})`, { cause: error })
      })
    await page.screenshot({ path: args.out, type: 'png' })
    return args.out
  } finally {
    await browser.close()
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
