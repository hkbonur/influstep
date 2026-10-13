import { EPISODE_STATUS_TINTS, SPONSOR_SEGMENT_LABELS, isPost, type PostKind } from '@influstep/shared'
import { Link } from '@tanstack/react-router'
import { api } from '@influstep/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import { PlatformGlyphs, PostKindIcon, TINT_CLASS } from './status'

export type CalendarEpisode = FunctionReturnType<typeof api.private.calendar.week>['days'][number]['episodes'][number]

/**
 * One episode on the calendar. The status is a wash and a dot; title at
 * weight 500; persona handle in mono; the episode's own platforms on the last
 * row, since an episode can go to fewer platforms than its persona has (DESIGN.md).
 * A post shows its kind icon and its first line where a video shows its title.
 */
export function EpisodeCard(props: { episode: CalendarEpisode }) {
  const episode = props.episode
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
          {isPost(episode.kind) ? (
            <PostLine kind={episode.kind} text={postLine(episode)} killed={episode.status === 'killed'} />
          ) : (
            <div
              className={cn('line-clamp-2 text-[13px] leading-snug font-medium text-ink', { 'line-through': episode.status === 'killed' })}
            >
              {episode.title}
            </div>
          )}
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

function PostLine(props: { kind: PostKind; text: string; killed: boolean }) {
  return (
    <div className="flex items-start gap-1.5">
      <PostKindIcon kind={props.kind} className="mt-[3px] shrink-0 text-graphite" />
      <span className={cn('line-clamp-2 min-w-0 text-[13px] leading-snug font-medium text-ink', { 'line-through': props.killed })}>
        {props.text}
      </span>
    </div>
  )
}

/**
 * A written post reads by its first line (the episode's hook). Before the
 * writer runs a post has no line yet, so the planned title stands in, the way
 * a video card shows its title before a script exists.
 */
function postLine(episode: CalendarEpisode): string {
  if (episode.hook === '') return episode.title
  return episode.hook
}
