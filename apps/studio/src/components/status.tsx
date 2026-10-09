import {
  EPISODE_STATUS_LABELS,
  EPISODE_STATUS_TINTS,
  PLATFORM_LABELS,
  SPONSOR_SEGMENT_LABELS,
  type EpisodeStatus,
  type Platform,
  type SponsorSegment,
  type StatusTint,
} from '@influstep/shared'
import { Pill } from './ui'

/** Literal class names, so Tailwind sees every tint utility (a template string would hide them). */
export const TINT_CLASS: Record<StatusTint, string> = {
  fog: 'tint-fog',
  'note-blue': 'tint-note-blue',
  'alert-amber': 'tint-alert-amber',
  smoke: 'tint-smoke',
  'field-green': 'tint-field-green',
  ink: 'tint-ink',
  'signal-red': 'tint-signal-red',
}

export function StatusPill(props: { status: EpisodeStatus }) {
  return (
    <Pill tint={EPISODE_STATUS_TINTS[props.status]} struck={props.status === 'killed'}>
      {EPISODE_STATUS_LABELS[props.status]}
    </Pill>
  )
}

export function SponsorPill(props: { segment: SponsorSegment }) {
  if (props.segment === 'none') return null
  return <Pill tint="ink">{SPONSOR_SEGMENT_LABELS[props.segment]}</Pill>
}

const GLYPH: Record<Platform, string> = { youtube: 'YT', tiktok: 'TT', instagram: 'IG' }

export function PlatformGlyphs(props: { platforms: readonly Platform[] }) {
  return (
    <span className="inline-flex gap-1" aria-label={props.platforms.map((platform) => PLATFORM_LABELS[platform]).join(', ')}>
      {props.platforms.map((platform) => (
        <span
          key={platform}
          title={PLATFORM_LABELS[platform]}
          className="rounded-sm bg-hairline-strong px-1 font-mono text-[10px] leading-4 text-graphite"
        >
          {GLYPH[platform]}
        </span>
      ))}
    </span>
  )
}
