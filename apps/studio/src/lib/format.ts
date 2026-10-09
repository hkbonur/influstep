/** Formatting for the operator's eyes: short, tabular, local. */

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1_000) return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}

export function formatPercent(rate: number, digits = 1): string {
  return `${(rate * 100).toFixed(digits)}%`
}

export function formatTime(at: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(at))
}

export function formatDateTime(at: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(at))
}

export function formatDay(day: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric' }): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, options).format(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000)
  const abs = Math.abs(seconds)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (abs < 60) return formatter.format(seconds, 'second')
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return formatter.format(Math.round(seconds / 3600), 'hour')
  return formatter.format(Math.round(seconds / 86_400), 'day')
}

/** Today as YYYY-MM-DD in the browser's timezone. */
export function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
  return date.toISOString().slice(0, 10)
}

export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  return addDays(day, -((date.getUTCDay() + 6) % 7))
}
