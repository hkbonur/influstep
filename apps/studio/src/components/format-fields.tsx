import {
  ASPECT_RATIOS,
  CADENCE_POSTS_MAX,
  CADENCE_POSTS_MIN,
  DEFAULT_FORMATS,
  DELIVERIES,
  DELIVERY_LABELS,
  EPISODE_KIND_LABELS,
  LENGTH_SEC_MAX,
  LENGTH_SEC_MIN,
  PLATFORMS,
  PLATFORM_LABELS,
  POST_INTENTS,
  POST_INTENT_LABELS,
  POST_KINDS,
  REPLIES_PER_DAY_MAX,
  REPLIES_PER_DAY_MIN,
  formatLength,
  postSlotHours,
  type Platform,
  type PlatformFormat,
  type PostIntent,
  type PostKind,
  type XCadence,
} from '@influstep/shared'
import { cn } from '@/lib/cn'
import { formatHour } from '@/lib/format'
import { Field, Input, Mono } from './ui'

/** The format a platform starts with when the operator switches it on; X's carries its default post cadence. */
export function defaultFormat(platform: Platform): PlatformFormat {
  return { platform, ...DEFAULT_FORMATS[platform] }
}

type FormatChange = Partial<Omit<PlatformFormat, 'platform'>>

/**
 * One row per platform: a checkbox, and the format the persona publishes
 * there once it is on. At least one platform stays on, so the last checked
 * box cannot be cleared. Rows keep PLATFORMS order whatever the operator
 * clicks first. Unticking a platform drops its whole format, so X's post
 * cadence goes with it.
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
        {props.value.some((format) => format.platform === 'x') && ' On X the persona also posts without a video, at the cadence above.'}
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
      {props.format.cadence && (
        <CadenceFields format={props.format} cadence={props.format.cadence} onChange={(cadence) => props.onChange({ cadence })} />
      )}
      <Field label="Hook note" className="col-span-2 lg:col-span-4">
        <Input required value={props.format.hookNote} onChange={(event) => props.onChange({ hookNote: event.target.value })} />
      </Field>
    </div>
  )
}

/**
 * X's post cadence: how many posts a day, three hours apart from the publish
 * hour, which kinds and intents the planner rotates through, and how many
 * replies the persona sends a day (zero turns listening off). Kinds keep
 * POST_KINDS order and intents POST_INTENTS order, and the last ticked one of
 * each cannot be cleared, because the backend refuses an X format without one.
 */
function CadenceFields(props: { format: PlatformFormat; cadence: XCadence; onChange: (cadence: XCadence) => void }) {
  const toggle = (kind: PostKind, on: boolean) =>
    props.onChange({
      ...props.cadence,
      kinds: POST_KINDS.filter((candidate) => (candidate === kind ? on : props.cadence.kinds.includes(candidate))),
    })
  const toggleIntent = (intent: PostIntent, on: boolean) =>
    props.onChange({
      ...props.cadence,
      intents: POST_INTENTS.filter((candidate) => (candidate === intent ? on : props.cadence.intents.includes(candidate))),
    })
  // The field reports every number the operator types, out of range ones too; the hours only mean something inside the range.
  const postsPerDay = props.cadence.postsPerDay
  const inRange = Number.isInteger(postsPerDay) && postsPerDay >= CADENCE_POSTS_MIN && postsPerDay <= CADENCE_POSTS_MAX
  return (
    <>
      <Field
        label="Posts a day"
        hint={inRange ? postSlotHours(props.format).map(formatHour).join(', ') : `${CADENCE_POSTS_MIN} to ${CADENCE_POSTS_MAX}`}
      >
        <NumberInput
          value={props.cadence.postsPerDay}
          min={CADENCE_POSTS_MIN}
          max={CADENCE_POSTS_MAX}
          onChange={(postsPerDay) => props.onChange({ ...props.cadence, postsPerDay })}
        />
      </Field>
      <fieldset className="col-span-2 flex flex-col gap-1.5 sm:col-span-1 lg:col-span-3">
        <legend className="mb-1.5 text-xs font-medium text-graphite">Post kinds</legend>
        <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1">
          {POST_KINDS.map((kind) => {
            const on = props.cadence.kinds.includes(kind)
            return (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-3.5 accent-ink"
                  checked={on}
                  disabled={on && props.cadence.kinds.length === 1}
                  onChange={(event) => toggle(kind, event.target.checked)}
                />
                {EPISODE_KIND_LABELS[kind]}
              </label>
            )
          })}
        </div>
      </fieldset>
      <Field label="Replies a day" hint={props.cadence.repliesPerDay === 0 ? 'Off: listens to nobody' : 'By hand and on its own'}>
        <NumberInput
          value={props.cadence.repliesPerDay}
          min={REPLIES_PER_DAY_MIN}
          max={REPLIES_PER_DAY_MAX}
          onChange={(repliesPerDay) => props.onChange({ ...props.cadence, repliesPerDay })}
        />
      </Field>
      {/* Under the kinds on wide screens: both lists say what the planner rotates through. */}
      <fieldset className="col-span-2 flex flex-col gap-1.5 lg:col-span-3">
        <legend className="mb-1.5 text-xs font-medium text-graphite">Post intents</legend>
        <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1">
          {POST_INTENTS.map((intent) => {
            const on = props.cadence.intents.includes(intent)
            return (
              <label key={intent} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-3.5 accent-ink"
                  checked={on}
                  disabled={on && props.cadence.intents.length === 1}
                  onChange={(event) => toggleIntent(intent, event.target.checked)}
                />
                {POST_INTENT_LABELS[intent]}
              </label>
            )
          })}
        </div>
      </fieldset>
    </>
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
