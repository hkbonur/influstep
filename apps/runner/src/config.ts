import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Runner configuration from `.env.local` (gitignored) next to the package,
 * then the shell. Explicit reads, explicit errors (ADR 0002).
 */
export const runnerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const artifactsDir = path.join(runnerRoot, 'artifacts')
export const profileDir = path.join(runnerRoot, 'profile')

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(index + 1).trim()
  }
}

loadEnvFile(path.join(runnerRoot, '.env.local'))
loadEnvFile(path.join(runnerRoot, '.env'))

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set (apps/runner/.env.local)`)
  return value
}

export type ProvidersMode = 'mock' | 'real'

export function providersMode(): ProvidersMode {
  const mode = process.env.PROVIDERS_MODE ?? 'mock'
  if (mode === 'mock' || mode === 'real') return mode
  throw new Error(`PROVIDERS_MODE must be "mock" or "real", got "${mode}"`)
}

export const config = {
  siteUrl: () => requireEnv('CONVEX_SITE_URL').replace(/\/$/, ''),
  token: () => requireEnv('RUNNER_TOKEN'),
  name: () => process.env.RUNNER_NAME ?? 'runner',
  version: '0.1.0',
}
