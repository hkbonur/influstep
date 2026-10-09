import { cn } from '@/lib/cn'
import { formatCount, formatDay, formatPercent } from '@/lib/format'

/**
 * The report's two charts, hand-drawn SVG so the colors stay the fixed
 * series of DESIGN.md: follows cyan, views violet, clicks amber, signups
 * emerald, paid red.
 */

const SERIES = {
  views: 'var(--color-chart-2)',
  follows: 'var(--color-chart-1)',
  clicks: 'var(--color-chart-3)',
  signups: 'var(--color-chart-4)',
  paid: 'var(--color-chart-5)',
} as const

export interface FunnelData {
  views: number
  follows: number
  clicks: number
  signups: number
  paid: number
}

const FUNNEL_STEPS: { key: keyof FunnelData; label: string }[] = [
  { key: 'views', label: 'Views' },
  { key: 'follows', label: 'Follows' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'signups', label: 'Attributed signups' },
  { key: 'paid', label: 'Paid' },
]

/** Five bars on a log-ish scale, each with its rate from the step before. */
export function Funnel(props: { data: FunnelData }) {
  const max = Math.max(1, props.data.views)
  return (
    <ol className="grid gap-2">
      {FUNNEL_STEPS.map((step, index) => {
        const value = props.data[step.key]
        const previous = index === 0 ? value : props.data[FUNNEL_STEPS[index - 1]!.key]
        const width = value === 0 ? 0 : Math.max(2, (Math.log10(value + 1) / Math.log10(max + 1)) * 100)
        return (
          <li key={step.key} className="grid grid-cols-[9rem_1fr_5rem] items-center gap-3 text-sm">
            <span className="text-graphite">{step.label}</span>
            <span className="h-5 overflow-hidden rounded-sm bg-hairline">
              <span
                className="block h-full rounded-sm transition-[width] duration-200 ease-out-quint"
                style={{ width: `${width}%`, background: SERIES[step.key] }}
              />
            </span>
            <span className="text-right">
              <span className="tabular font-medium">{formatCount(value)}</span>
              {index > 0 && (
                <span className="tabular ml-1.5 text-xs text-ash">{previous === 0 ? '' : formatPercent(value / previous)}</span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export interface TrendPoint {
  day: string
  views: number
  clicks: number
  signups: number
}

/** One line chart with three series on their own scales; the reader compares shape, not height. */
export function Trend(props: { points: TrendPoint[]; className?: string }) {
  const width = 640
  const height = 160
  const pad = { top: 8, right: 8, bottom: 20, left: 8 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const keys = ['views', 'clicks', 'signups'] as const
  const x = (index: number) => pad.left + (props.points.length <= 1 ? innerW / 2 : (index / (props.points.length - 1)) * innerW)
  const paths = keys.map((key) => {
    const max = Math.max(1, ...props.points.map((point) => point[key]))
    const d = props.points
      .map(
        (point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${(pad.top + innerH - (point[key] / max) * innerH).toFixed(1)}`
      )
      .join(' ')
    return { key, d, max, total: props.points.reduce((sum, point) => sum + point[key], 0) }
  })
  const labelEvery = Math.max(1, Math.round(props.points.length / 6))
  return (
    <figure className={cn('grid gap-2', props.className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label="Views, clicks and signups per day">
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + innerH * fraction}
            y2={pad.top + innerH * fraction}
            stroke="var(--color-mist)"
            strokeDasharray="2 4"
          />
        ))}
        {paths.map((path) => (
          <path
            key={path.key}
            d={path.d}
            fill="none"
            stroke={SERIES[path.key]}
            strokeWidth={path.key === 'views' ? 1.5 : 2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {props.points.map(
          (point, index) =>
            index % labelEvery === 0 && (
              <text key={point.day} x={x(index)} y={height - 4} textAnchor="middle" className="fill-ash font-mono text-[10px]">
                {formatDay(point.day, { month: 'short', day: 'numeric' })}
              </text>
            )
        )}
      </svg>
      <figcaption className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ash">
        {paths.map((path) => (
          <span key={path.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: SERIES[path.key] }} />
            {path.key === 'views' ? 'Views' : path.key === 'clicks' ? 'Clicks' : 'Signups'}
            <span className="tabular text-graphite">{formatCount(path.total)}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

export function MetricStrip(props: { items: { label: string; value: string; note?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
      {props.items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="eyebrow">{item.label}</dt>
          <dd className="text-metric tabular mt-1">{item.value}</dd>
          {item.note && <dd className="mt-0.5 text-xs text-ash">{item.note}</dd>}
        </div>
      ))}
    </dl>
  )
}
