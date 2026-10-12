import { EPISODE_STATUS_TINTS, SPONSOR_SEGMENT_LABELS } from '@influstep/shared'
import { Link } from '@tanstack/react-router'
import { api } from '@influstep/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import { PlatformGlyphs, TINT_CLASS } from './status'

export type CalendarEpisode = FunctionReturnType<typeof api.private.calendar.week>['days'][number]['episodes'][number]

/**
 * One episode on the calendar. The status is a wash and a dot; title at
 * weight 500; persona handle in mono; the episode's own platforms on the last
 * row, since an episode can go to fewer platforms than its persona has (DESIGN.md).
 */
export function EpisodeCard(props: { episode: CalendarEpisode }) {
  const { episode } = props
  const loud = episode.status === 'failed' || episode.status === 'waiting_on_you' || episode.status === 'scripted'
  return (
    <Link
      to="/episodes/$episodeId"
      params={{ episodeId: episode._id }}
      className={cn(
        TINT_CLASS[EPISODE_STATUS_TINTS[episode.status]],
        'block min-w-0 rounded-lg border border-transparent px-2.5 py-2 transition-colors duration-150 ease-out-quint',
        'bg-[color-mix(in_oklch,var(--tint)_6%,var(--color-paper))] hover:border-[color-mix(in_oklch,var(--tint)_40%,transparent)]',
        { 'border-[color-mix(in_oklch,var(--tint)_35%,transparent)]': loud, 'opacity-60': episode.status === 'killed' }
      )}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--tint)]" />
        <div className="min-w-0 flex-1">
          <div
            className={cn('line-clamp-2 text-[13px] leading-snug font-medium text-ink', { 'line-through': episode.status === 'killed' })}
          >
            {episode.title}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[11px] text-ash">@{episode.persona.handle}</span>
            <span className="tabular shrink-0 text-[11px] text-ash">{formatTime(episode.scheduledAt)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-ash">
            <PlatformGlyphs platforms={episode.platforms} />
            {episode.sponsorSegment !== 'none' && <span className="truncate">{SPONSOR_SEGMENT_LABELS[episode.sponsorSegment]}</span>}
          </div>
          {episode.error && <div className="mt-1 line-clamp-2 font-mono text-[11px] text-signal-red-deep">{episode.error}</div>}
        </div>
      </div>
    </Link>
  )
}
