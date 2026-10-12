import {
  ASPECT_RATIOS,
  DEFAULT_FORMATS,
  DELIVERIES,
  DELIVERY_LABELS,
  LENGTH_SEC_MAX,
  LENGTH_SEC_MIN,
  PLATFORMS,
  PLATFORM_LABELS,
  formatLength,
  type Platform,
  type PlatformFormat,
} from '@influstep/shared'
import { cn } from '@/lib/cn'
import { Field, Input, Mono } from './ui'

/** The format a platform starts with when the operator switches it on. */
export function defaultFormat(platform: Platform): PlatformFormat {
  return { platform, ...DEFAULT_FORMATS[platform] }
}

type FormatChange = Partial<Omit<PlatformFormat, 'platform'>>

/**
 * One row per platform: a checkbox, and the format the persona publishes
 * there once it is on. At least one platform stays on, so the last checked
 * box cannot be cleared. Rows keep PLATFORMS order whatever the operator
 * clicks first.
 */
export function FormatFields(props: { value: PlatformFormat[]; onChange: (next: PlatformFormat[]) => void; className?: string }) {
  const toggle = (platform: Platform, on: boolean) =>
    props.onChange(
      PLATFORMS.flatMap((candidate) => {
        if (candidate === platform) return on ? [defaultFormat(platform)] : []
        const current = props.value.find((format) => format.platform === candidate)
        return current ? [current] : []
      })
    )
  const patch = (platform: Platform, change: FormatChange) =>
    props.onChange(props.value.map((format) => (format.platform === platform ? { ...format, ...change } : format)))

  return (
    <fieldset className={cn('flex flex-col gap-1.5', props.className)}>
      <legend className="text-xs font-medium text-graphite">Platforms</legend>
      <div className="divide-y divide-mist border-y border-mist">
        {PLATFORMS.map((platform) => {
          const format = props.value.find((candidate) => candidate.platform === platform)
          return (
            <div key={platform} className="grid gap-x-4 gap-y-2 py-2.5 lg:grid-cols-[6.5rem_minmax(0,1fr)]">
              <label className="flex h-8 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-3.5 accent-ink"
                  checked={format !== undefined}
                  disabled={format !== undefined && props.value.length === 1}
                  onChange={(event) => toggle(platform, event.target.checked)}
                />
                {PLATFORM_LABELS[platform]}
              </label>
              {format && <FormatRow format={format} onChange={(change) => patch(platform, change)} />}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-ash">
        One script goes to every platform of an episode: it fits the shortest length and is produced the way the longest-form platform
        needs.
      </p>
    </fieldset>
  )
}

function FormatRow(props: { format: PlatformFormat; onChange: (change: FormatChange) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Field label="Length">
        <span className="flex items-center gap-2">
          <NumberInput
            value={props.format.lengthSec}
            min={LENGTH_SEC_MIN}
            max={LENGTH_SEC_MAX}
            className="min-w-0 flex-1"
            onChange={(lengthSec) => props.onChange({ lengthSec })}
          />
          <Mono className="shrink-0 text-ash">{formatLength(props.format.lengthSec)}</Mono>
        </span>
      </Field>
      <Field label="Aspect">
        <select
          className="field"
          value={props.format.aspect}
          onChange={(event) => props.onChange({ aspect: pick(ASPECT_RATIOS, event.target.value) })}
        >
          {ASPECT_RATIOS.map((aspect) => (
            <option key={aspect} value={aspect}>
              {aspect}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Delivery" className="col-span-2 sm:col-span-1">
        <select
          className="field"
          value={props.format.delivery}
          onChange={(event) => props.onChange({ delivery: pick(DELIVERIES, event.target.value) })}
        >
          {DELIVERIES.map((delivery) => (
            <option key={delivery} value={delivery}>
              {DELIVERY_LABELS[delivery]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Publish hour">
        <NumberInput value={props.format.publishHour} min={0} max={23} onChange={(publishHour) => props.onChange({ publishHour })} />
      </Field>
      <Field label="Hook note" className="col-span-2 lg:col-span-4">
        <Input required value={props.format.hookNote} onChange={(event) => props.onChange({ hookNote: event.target.value })} />
      </Field>
    </div>
  )
}

/**
 * Uncontrolled on purpose: a controlled number input snaps back the moment the
 * operator clears it to type a new value. The parent hears every finite value,
 * and the browser refuses an empty or out-of-range field at submit.
 */
function NumberInput(props: { value: number; min: number; max: number; className?: string; onChange: (value: number) => void }) {
  return (
    <Input
      type="number"
      required
      min={props.min}
      max={props.max}
      step={1}
      defaultValue={props.value}
      className={props.className}
      onChange={(event) => {
        const next = event.target.valueAsNumber
        if (Number.isNaN(next)) return
        props.onChange(next)
      }}
    />
  )
}

/** A select offers only the listed options, so a value outside them is a bug, not input. */
function pick<T extends string>(options: readonly T[], value: string): T {
  const found = options.find((option) => option === value)
  if (found === undefined) throw new Error(`${value} is not one of ${options.join(', ')}`)
  return found
}
