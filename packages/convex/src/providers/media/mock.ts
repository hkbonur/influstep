import { PERSONA_COLOR_VALUES } from '@influstep/shared'
import type { MediaProvider, MediaRequest } from './types'

/** The characters a card line holds before it wraps, at the card's font size. */
const LINE_CHARS = 30
/** A square card holds fewer characters a line. */
const SQUARE_LINE_CHARS = 18
const LINES_MAX = 5

/** The prompt broken into lines at word boundaries, the last one cut short with an ellipsis when it does not fit. */
export function cardLines(text: string, chars: number = LINE_CHARS): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (next.length > chars && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  if (lines.length <= LINES_MAX) return lines
  return [...lines.slice(0, LINES_MAX - 1), `${(lines[LINES_MAX - 1] ?? '').slice(0, chars - 1)}…`]
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * A placeholder the whole path runs on without keys (docs/plan.md, slice 15):
 * the prompt on a 16:9 card in the persona's color, saying it is a mock. A
 * clip is the same card, a still the producer holds for the beat.
 */
export function mockCard(request: MediaRequest): string {
  const width = request.shape === 'square' ? 1080 : 1920
  const lines = cardLines(request.shownPrompt, request.shape === 'square' ? SQUARE_LINE_CHARS : LINE_CHARS)
  const top = 500 - (lines.length * 104) / 2 + 72
  const text = lines.map((line, index) => `<tspan x="160" y="${top + index * 104}">${escapeXml(line)}</tspan>`).join('')
  const what = request.shape === 'square' ? 'Portrait' : request.kind === 'clip' ? 'Clip' : 'Image'
  const label = `${what} for ${request.personaName} · mock, generated`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="1080" viewBox="0 0 ${width} 1080">
<rect width="${width}" height="1080" fill="${PERSONA_COLOR_VALUES[request.color]}"/>
<rect x="96" y="96" width="${width - 192}" height="888" rx="48" fill="none" stroke="#fafafa" stroke-opacity="0.35" stroke-width="4"/>
<text font-family="Inter, system-ui, sans-serif" font-size="84" font-weight="600" fill="#fafafa">${text}</text>
<text x="160" y="900" font-family="ui-monospace, monospace" font-size="36" fill="#fafafa" fill-opacity="0.8">${escapeXml(label)}</text>
</svg>`
}

export const mockMedia: MediaProvider = {
  name: 'mock',
  async generate(request) {
    const encoded = new TextEncoder().encode(mockCard(request))
    const bytes = new ArrayBuffer(encoded.byteLength)
    new Uint8Array(bytes).set(encoded)
    return {
      bytes,
      contentType: 'image/svg+xml',
      model: 'mock',
      mock: true,
    }
  },
}
