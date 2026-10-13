import { api } from '@influstep/convex/_generated/api'
import type { Doc } from '@influstep/convex/_generated/dataModel'
import {
  CARD_TITLE_MAX,
  THREAD_PARTS_MAX,
  THREAD_PARTS_MIN,
  X_POST_LIMIT,
  postProblems,
  textEditable,
  xLength,
  type EpisodePost,
  type EpisodeStatus,
  type PostKind,
} from '@influstep/shared'
import { useMutation } from 'convex/react'
import React from 'react'
import { cn } from '@/lib/cn'
import { counterTone } from '@/lib/counter'
import { errorMessage } from '@/lib/errors'
import { Button, ErrorLine, Field, type FormState, Input, Textarea } from './ui'

/** One part as the editor holds it: the id keeps a textarea's focus and undo with its text when a part above it is removed. */
interface PartDraft {
  id: string
  text: string
}

interface PostEditorProps {
  episode: Doc<'episodes'>
  kind: PostKind
  persona: { name: string; handle: string }
  /** The card the producer rendered for an image post, or null until it exists. */
  card: { url: string | null; mock: boolean } | null
}

/**
 * The post an X episode publishes, exactly as X will show it: nothing is
 * appended, no link and no code. Text and image posts are one part, a thread
 * is two to six; every part counts the way X does against the full limit. An
 * image post also has the card title the producer renders, with a 16:9
 * preview of the card.
 */
export function PostEditor(props: PostEditorProps) {
  const update = useMutation(api.private.episodes.updatePost)
  const [title, setTitle] = React.useState(props.episode.title)
  const [parts, setParts] = React.useState<PartDraft[]>(() => initialParts(props.kind, props.episode.post))
  const [cardTitle, setCardTitle] = React.useState(props.episode.post?.cardTitle ?? '')
  // No "saved" state: the page keys the editor on the saved post, so a save that goes through remounts it clean.
  const [state, setState] = React.useState<FormState>({ status: 'idle' })

  const locked = !textEditable(props.episode.status)
  const post: EpisodePost =
    props.kind === 'image' ? { parts: parts.map((part) => part.text), cardTitle } : { parts: parts.map((part) => part.text) }
  const written = props.episode.post
  const dirty =
    title !== props.episode.title ||
    written === undefined ||
    JSON.stringify(post.parts) !== JSON.stringify(written.parts) ||
    (props.kind === 'image' && cardTitle !== written.cardTitle)
  const problems = postProblems(props.kind, post)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setState({ status: 'saving' })
    try {
      await update({ episodeId: props.episode._id, title, post })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const setPart = (id: string, text: string) => setParts((current) => current.map((part) => (part.id === id ? { ...part, text } : part)))
  const addPart = (part: PartDraft) => setParts((current) => [...current, part])
  const removePart = (id: string) => setParts((current) => current.filter((part) => part.id !== id))

  return (
    <form onSubmit={save} className="grid gap-4">
      <Field label="Title" hint="For the episode list and the report; X shows only the post.">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} disabled={locked} />
      </Field>
      {props.kind === 'thread' && <ThreadParts parts={parts} locked={locked} onChange={setPart} onAdd={addPart} onRemove={removePart} />}
      {/* One part; a text or an image post with more is refused by postProblems below, not hidden here. */}
      {props.kind !== 'thread' &&
        parts.map((part) => (
          <PartField key={part.id} label="Post" text={part.text} locked={locked} onChange={(text) => setPart(part.id, text)} />
        ))}
      {props.kind === 'image' && (
        <CardFields cardTitle={cardTitle} locked={locked} persona={props.persona} card={props.card} onChange={setCardTitle} />
      )}
      <div>
        {/*
          The live region stays in the page while the list comes and goes, so a screen reader hears each problem as it
          appears and learns why Save is off. Not role="status": that reads the whole list again on every change.
        */}
        <div aria-live="polite">
          {!locked && problems.length > 0 && (
            <ul className="mb-4 space-y-0.5 text-xs text-signal-red-deep">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!locked && (
            <Button type="submit" variant="primary" busy={state.status === 'saving'} disabled={!dirty || problems.length > 0}>
              Save post
            </Button>
          )}
          <span className="text-xs text-ash">
            X counts every link as 23 characters.
            {locked && ` ${lockNote(props.episode.status)}`}
          </span>
        </div>
      </div>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
    </form>
  )
}

/**
 * Two to six numbered parts, each held to X's full limit. Adding or removing
 * a part moves keyboard focus to a part's textarea: the removed button leaves
 * the page and the Add button disables itself at six, and either would drop
 * focus to the top of the page.
 */
function ThreadParts(props: {
  parts: PartDraft[]
  locked: boolean
  onChange: (id: string, text: string) => void
  onAdd: (part: PartDraft) => void
  onRemove: (id: string) => void
}) {
  const textareas = React.useRef(new Map<string, HTMLTextAreaElement>())
  // The part just added, focused when its textarea mounts.
  const focusOnMount = React.useRef<string | null>(null)

  const registerTextarea = (id: string) => (element: HTMLTextAreaElement | null) => {
    if (!element) return
    textareas.current.set(id, element)
    if (focusOnMount.current === id) {
      focusOnMount.current = null
      element.focus()
    }
    return () => {
      textareas.current.delete(id)
    }
  }
  const add = () => {
    const part = newPart('')
    focusOnMount.current = part.id
    props.onAdd(part)
  }
  const remove = (id: string) => {
    const index = props.parts.findIndex((part) => part.id === id)
    // The part before takes focus, or, when the first part goes, the one that becomes first.
    const neighbour = index > 0 ? props.parts[index - 1] : props.parts[index + 1]
    props.onRemove(id)
    // Remove is disabled at the fewest parts a thread allows, so a neighbour always exists; without one focus stays put.
    if (!neighbour) return
    const textarea = textareas.current.get(neighbour.id)
    // Every part's textarea registers on mount, so a missing one is a part that is not on the page; nothing to focus.
    if (!textarea) return
    textarea.focus()
  }

  return (
    <div className="grid gap-3">
      <ol className="grid gap-3">
        {props.parts.map((part, index) => (
          <li key={part.id}>
            <PartField
              label={`Part ${index + 1}`}
              text={part.text}
              locked={props.locked}
              onChange={(text) => props.onChange(part.id, text)}
              registerTextarea={registerTextarea(part.id)}
              action={
                !props.locked && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={props.parts.length <= THREAD_PARTS_MIN}
                    onClick={() => remove(part.id)}
                    aria-label={`Remove part ${index + 1}`}
                  >
                    Remove
                  </Button>
                )
              }
            />
          </li>
        ))}
      </ol>
      {!props.locked && (
        <div>
          <Button size="sm" disabled={props.parts.length >= THREAD_PARTS_MAX} onClick={add}>
            Add part
          </Button>
        </div>
      )}
    </div>
  )
}

/** A part's textarea with its live counter; the label row also holds the thread's remove button. */
function PartField(props: {
  label: string
  text: string
  locked: boolean
  onChange: (text: string) => void
  action?: React.ReactNode
  /** The thread keeps each part's textarea, so adding or removing a part can move focus. */
  registerTextarea?: React.RefCallback<HTMLTextAreaElement>
}) {
  const id = React.useId()
  const counterId = `${id}-counter`
  return (
    <div className="grid gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-graphite">
          {props.label}
        </label>
        <span className="flex items-center gap-2">
          <Counter id={counterId} length={xLength(props.text)} limit={X_POST_LIMIT} />
          {props.action}
        </span>
      </div>
      <Textarea
        id={id}
        // Wrapped, not passed straight through: the compiler takes a prop handed to `ref` as a ref and skips the component.
        ref={(element) => props.registerTextarea?.(element)}
        aria-describedby={counterId}
        value={props.text}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={props.locked}
        className="min-h-24"
      />
    </div>
  )
}

/**
 * `len / limit` in 11px mono: ash under 90 percent, amber up to the limit, red
 * past it (DESIGN.md, Character counter). The field it counts points to it,
 * and it is a polite live region that says near or over the limit in words,
 * since a screen reader does not get the color.
 */
function Counter(props: { id: string; length: number; limit: number }) {
  const tone = counterTone(props.length, props.limit)
  return (
    <span
      id={props.id}
      aria-live="polite"
      aria-atomic="true"
      className={cn('tabular font-mono text-[11px]', {
        'text-ash': tone === 'quiet',
        'text-alert-amber-deep': tone === 'near',
        'text-signal-red-deep': tone === 'over',
      })}
    >
      {props.length} / {props.limit}
      <span className="sr-only">
        {' characters'}
        {tone === 'near' && ', near the limit'}
        {tone === 'over' && ', over the limit'}
      </span>
    </span>
  )
}

/**
 * The card title and its 16:9 card: the render once the producer made it, a
 * preview drawn like the producer's card until then. Once the card is rendered its
 * title locks, because a retry publishes that card as it is (core/posts.ts
 * refuses the change too); Rewrite drops the card and opens the title again.
 */
function CardFields(props: {
  cardTitle: string
  locked: boolean
  persona: { name: string; handle: string }
  card: { url: string | null; mock: boolean } | null
  onChange: (cardTitle: string) => void
}) {
  const id = React.useId()
  const counterId = `${id}-counter`
  const rendered = props.card !== null
  return (
    <div className="grid gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-graphite">
          Card title
        </label>
        <Counter id={counterId} length={Array.from(props.cardTitle).length} limit={CARD_TITLE_MAX} />
      </div>
      <Input
        id={id}
        aria-describedby={counterId}
        value={props.cardTitle}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={props.locked || rendered}
      />
      {/* An approved post says why it is locked under the editor; this is the one lock an editable post has. */}
      {rendered && !props.locked && <span className="text-xs text-ash">The card is rendered; Rewrite to change it.</span>}
      <CardPreview cardTitle={props.cardTitle} persona={props.persona} card={props.card} />
    </div>
  )
}

function CardPreview(props: {
  cardTitle: string
  persona: { name: string; handle: string }
  card: { url: string | null; mock: boolean } | null
}) {
  if (props.card) {
    if (props.card.url === null) return <ErrorLine>The rendered card is missing from storage.</ErrorLine>
    return (
      <figure className="mt-1 max-w-md">
        {/* The title field locks once the card exists, so this is the title the picture shows, not a draft. */}
        <img src={props.card.url} alt={props.cardTitle} className="aspect-video w-full rounded-lg bg-paper-warm object-cover" />
        <figcaption className="mt-1 font-mono text-[11px] text-ash">16:9 card{props.card.mock && ' · mock'}</figcaption>
      </figure>
    )
  }
  return (
    <figure className="mt-1 max-w-md">
      {/* Drawn like the runner's title card (apps/runner/src/record.ts), near-white with the title in ink, so the preview is what X will show. */}
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-mist bg-paper-tint px-[8%] text-center">
        <span
          className={cn('text-lg leading-tight font-semibold tracking-[-0.02em] text-ink', { 'text-ash italic': props.cardTitle === '' })}
        >
          {props.cardTitle === '' ? 'No card title yet' : props.cardTitle}
        </span>
        <span className="font-mono text-[11px] text-ash">
          {props.persona.name} · @{props.persona.handle}
        </span>
      </div>
      <figcaption className="mt-1 text-xs text-ash">Preview. The producer renders the card after approval.</figcaption>
    </figure>
  )
}

/** Why the editor is read only: a killed episode locks whether or not it was approved; every other lock comes with approval. */
function lockNote(status: EpisodeStatus): string {
  if (status === 'killed') return 'Killed episodes are locked.'
  return 'Locked once approved.'
}

function newPart(text: string): PartDraft {
  return { id: crypto.randomUUID(), text }
}

/**
 * The parts the editor opens with: the written post, or, before the writer
 * has run, the fewest empty parts the kind allows, so the operator can write
 * it by hand.
 */
function initialParts(kind: PostKind, post: EpisodePost | undefined): PartDraft[] {
  if (post) return post.parts.map(newPart)
  const count = kind === 'thread' ? THREAD_PARTS_MIN : 1
  return Array.from({ length: count }, () => newPart(''))
}
