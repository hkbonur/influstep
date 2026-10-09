import type { Platform } from './platforms'

export interface Attribution {
  personaHandle: string
  platform: Platform | 'bio'
  episodeSlug?: string
  variantKey?: string
}

/** ADR 0003: the UTM set every tracked link redirects with. */
export function buildAttributedUrl(target: string, attribution: Attribution): string {
  const url = new URL(target)
  url.searchParams.set('utm_source', attribution.personaHandle)
  url.searchParams.set('utm_medium', attribution.platform)
  if (attribution.episodeSlug) url.searchParams.set('utm_campaign', attribution.episodeSlug)
  if (attribution.variantKey) url.searchParams.set('utm_content', attribution.variantKey)
  return url.toString()
}

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

/** Short, unambiguous, lowercase. Deterministic when a seed is given (tests, mocks). */
export function makeSlug(length: number, seed?: number): string {
  let state = seed ?? Math.floor(Math.random() * 0xffffffff)
  let out = ''
  for (let i = 0; i < length; i += 1) {
    // mulberry32 step: stable sequence from one seed
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    out += SLUG_ALPHABET[Math.floor(r * SLUG_ALPHABET.length)]
  }
  return out
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
