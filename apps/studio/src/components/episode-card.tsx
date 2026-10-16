import {
  EPISODE_STATUS_LABELS,
  EPISODE_STATUS_TINTS,
  SPONSOR_SEGMENT_LABELS,
  isPost,
  waitsOnOperator,
  type PostKind,
} from '@influstep/shared'
import { Link } from '@tanstack/react-router'
import { api } from '@influstep/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import { ideaLine } from '@/lib/ideas'
import { PersonaAvatar } from './persona-avatar'
import { PlatformGlyphs, PostKindIcon, PostShape, TINT_CLASS } from './status'

export type CalendarEpisode = FunctionReturnType<typeof api.private.calendar.week>['days'][number]['episodes'][number]

/**
 * One episode on the calendar. The status is a wash and a dot; title at
 * weight 500; one meta row under it with the persona's avatar, the publish
 * time and the episode's own platforms, since an episode can go to fewer
 * platforms than its persona has (DESIGN.md).
 * A post shows its kind icon and its first line where a video shows its title,
 * and under it what the planner asked of it: the intent and the length. An
 * idea has no words yet, so it says when the writer gets to them, or that it is
 * on them now.
 */
export function EpisodeCard(props: { episode: CalendarEpisode }) {
  const episode = props.episode
  // A border when the card needs the operator: it waits on them, or it failed.
  const loud = waitsOnOperator(episode.status) || episode.status === 'failed'
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
        {/* The dot's color is the status; screen readers hear its name first, the way the eye meets the dot. */}
        <span className="sr-only">{EPISODE_STATUS_LABELS[episode.status]}:</span>
        <div className="min-w-0 flex-1">
          {isPost(episode.kind) ? (
            <>
              <PostLine kind={episode.kind} text={postLine(episode)} killed={episode.status === 'killed'} />
              {/* Indented past the kind icon, so it reads as part of the post line above it. */}
              <PostShape intent={episode.intent} length={episode.length} className="mt-0.5 block pl-5" />
            </>
          ) : (
            <div
              className={cn('line-clamp-2 text-[13px] leading-snug font-medium text-ink', { 'line-through': episode.status === 'killed' })}
            >
              {episode.title}
            </div>
          )}
          {episode.status === 'idea' && (
            <div className={cn('mt-0.5 text-[11px] text-ash', { 'pl-5': isPost(episode.kind) })}>{ideaLine(episode, episode.writing)}</div>
          )}
          {episode.sponsorSegment !== 'none' && (
            <div className={cn('mt-0.5 truncate text-[11px] text-ash', { 'pl-5': isPost(episode.kind) })}>
              {SPONSOR_SEGMENT_LABELS[episode.sponsorSegment]}
            </div>
          )}
          {episode.error && <div className="mt-1 line-clamp-1 font-mono text-[11px] text-signal-red-deep">{episode.error}</div>}
          {/* One meta row: whose it is (the avatar's color, its name for screen readers), when, and where it goes. */}
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ash">
            <PersonaAvatar color={episode.persona.color} state="idle" size={14} />
            <span className="sr-only">{episode.persona.name},</span>
            <span className="tabular shrink-0">{formatTime(episode.scheduledAt)}</span>
            <PlatformGlyphs platforms={episode.platforms} bare className="ml-auto" />
          </div>
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
