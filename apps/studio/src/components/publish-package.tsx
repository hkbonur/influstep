import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import {
  PLATFORMS,
  PLATFORM_LABELS,
  PUBLICATION_BODY_MAX,
  PUBLICATION_TITLE_MAX,
  X_POST_LIMIT,
  xLength,
  type EpisodeKind,
  type EpisodeStatus,
  type Platform,
} from '@influstep/shared'
import { useMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { CharacterCounter } from './character-counter'
import { PostParts } from './post-parts'
import { PublicationStatusPill } from './status'
import { Button, ErrorLine, Eyebrow, type FormState, Input, Mono, Textarea } from './ui'

type EpisodeData = NonNullable<FunctionReturnType<typeof api.private.episodes.get>>
type Publication = EpisodeData['publications'][number]
type Footer = NonNullable<Publication['footer']>
type TrackedLink = EpisodeData['links'][number]

/** What the operator typed into a draft and has not saved yet: the title, and away from X the persona's own description. */
export interface DraftEdit {
  title: string
  body: string
}

/**
 * Unsaved edits by publication, held by the episode page so its Approve and
 * schedule button knows about them. A publication without an entry shows what
 * is saved; a save that goes through drops the entry.
 */
export type DraftEdits = Partial<Record<Id<'publications'>, DraftEdit>>

/**
 * The publications of an episode, one block per platform in platform order.
 * A video or an image post waits here as a publish package (CONTEXT.md,
 * "Publish package") until the operator approves it, unless the persona
 * publishes on its own: while a block is a draft its title and the persona's
 * own description are editable, and the lines added around the description
 * when it goes out show under it, composed with the code in force now. After
 * approval every block is read only and shows its publication's status. A
 * text post or a thread is scheduled by its approval, so its publications are
 * listed the same way but were never a package.
 */
export function PublicationsSection(props: {
  kind: EpisodeKind
  episodeStatus: EpisodeStatus
  timezone: string
  publications: Publication[]
  links: TrackedLink[]
  appUrl: string
  codesSent: { code: string; offer: string }[]
  edits: DraftEdits
  onEdit: (publicationId: Id<'publications'>, edit: DraftEdit | null) => void
  /** What the header's Approve and schedule did, said in the section's live line; null until it has run. */
  notice: string | null
  /** The id of that live line, so the page can move focus to it once the button it came from leaves. */
  statusId: string
}) {
  const ordered = [...props.publications].sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform))
  const waiting = props.episodeStatus === 'rendered' && props.publications.some((publication) => publication.status === 'draft')
  const unsaved = unsavedPlatforms(props.publications, props.edits)
  const listOnly = props.kind === 'text' || props.kind === 'thread'
  return (
    <section>
      <Eyebrow className="mb-3">{listOnly ? 'Publications' : 'Publish package'}</Eyebrow>
      {waiting && (
        <p className="mb-2 max-w-[65ch] text-sm">
          Nothing goes out until you approve it.
          {props.kind === 'video' && ' The lines around each description are added when it goes out, with the code in force then.'}
        </p>
      )}
      {/*
        Stays mounted, so the reason Approve and schedule is off is announced as it appears and as it clears, and so is
        what approving did. It takes focus after approval, since the button that had it leaves the page.
      */}
      <p id={props.statusId} tabIndex={-1} aria-live="polite" className="text-sm outline-none">
        {unsaved.length > 0
          ? `Save or discard the ${joinWords(unsaved.map((platform) => PLATFORM_LABELS[platform]))} edits before you approve.`
          : props.notice}
      </p>
      {props.codesSent.length > 0 && <CodesSent codes={props.codesSent} />}
      <ol className="mt-2 divide-y divide-mist border-y border-mist">
        {ordered.map((publication) => (
          <li key={publication._id}>
            <PublicationBlock
              kind={props.kind}
              publication={publication}
              editable={props.episodeStatus === 'rendered' && publication.status === 'draft' && publication.parts === undefined}
              timezone={props.timezone}
              link={props.links.find((link) => link._id === publication.linkId)}
              appUrl={props.appUrl}
              edit={props.edits[publication._id]}
              onEdit={(edit) => props.onEdit(publication._id, edit)}
            />
          </li>
        ))}
      </ol>
    </section>
  )
}

/** The platforms whose drafts hold edits that differ from what is saved: approving now would publish the saved text instead. */
export function unsavedPlatforms(publications: Publication[], edits: DraftEdits): Platform[] {
  return publications
    .filter((publication) => {
      if (publication.status !== 'draft') return false
      const edit = edits[publication._id]
      if (edit === undefined) return false
      return differs(publication, edit)
    })
    .map((publication) => publication.platform)
}

function PublicationBlock(props: {
  kind: EpisodeKind
  publication: Publication
  editable: boolean
  timezone: string
  link: TrackedLink | undefined
  appUrl: string
  edit: DraftEdit | undefined
  onEdit: (edit: DraftEdit | null) => void
}) {
  const publication = props.publication
  const hasRender = props.kind === 'video' || props.kind === 'image'
  return (
    <div className={cn('grid gap-4 py-4', { 'sm:grid-cols-[auto_minmax(0,1fr)]': hasRender })}>
      {hasRender && <RenderFrame image={props.kind === 'image'} url={publication.renderUrl} aspect={publication.aspect} />}
      <div className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="font-medium">{PLATFORM_LABELS[publication.platform]}</h3>
          {/* A draft being edited needs no pill: the fields say it is open. Every other block shows where it stands. */}
          {!props.editable && <PublicationStatusPill status={publication.status} />}
          <PublishTime publication={publication} timezone={props.timezone} />
        </div>
        <BlockText publication={publication} editable={props.editable} edit={props.edit} onEdit={props.onEdit} />
        {publication.url && (
          <a
            href={publication.url}
            target="_blank"
            rel="noreferrer"
            className="truncate font-mono text-[11px] text-graphite hover:underline"
          >
            {publication.url}
          </a>
        )}
        {/* Nothing is appended on X, so its tracked link never reaches a reader; showing it would suggest it does. */}
        {props.link && publication.platform !== 'x' && (
          <span className="font-mono text-[11px] text-ash">
            {props.appUrl}/go/{props.link.slug} · {props.link.clicks} clicks
          </span>
        )}
        {publication.error && <ErrorLine>{publication.error}</ErrorLine>}
      </div>
    </div>
  )
}

/** When it went out, or when it goes out, on the persona's clock: the one its publish hours are set in. */
function PublishTime(props: { publication: Publication; timezone: string }) {
  const publishedAt = props.publication.publishedAt
  return (
    <span className="ml-auto text-[11px] text-ash">
      {publishedAt === undefined ? 'Goes out' : 'Published'}{' '}
      <Mono className="text-[11px] text-graphite">
        {formatDateTime(publishedAt === undefined ? props.publication.scheduledAt : publishedAt, props.timezone)}
      </Mono>{' '}
      {props.timezone}
    </span>
  )
}

/**
 * The render the publication uploads, in a frame of its aspect: muted and
 * still until the operator plays it. An image post shows its card. The
 * backend names no render when the episode has none for the publication's
 * aspect, and the block says so instead of drawing an empty frame.
 */
function RenderFrame(props: { image: boolean; url: string | null; aspect: Publication['aspect'] }) {
  if (props.url === null || props.aspect === undefined) return <p className="text-xs text-ash sm:w-44">Render missing</p>
  return (
    <figure className={cn({ 'w-full max-w-72 sm:w-72': props.aspect === '16:9', 'w-40 sm:w-44': props.aspect === '9:16' })}>
      {props.image ? (
        <img src={props.url} alt="The rendered card" className="aspect-video w-full rounded-lg bg-paper-warm object-cover" />
      ) : (
        <video
          src={props.url}
          controls
          muted
          playsInline
          preload="metadata"
          className={cn('w-full rounded-lg bg-ink-deep', {
            'aspect-video': props.aspect === '16:9',
            'aspect-[9/16]': props.aspect === '9:16',
          })}
        />
      )}
      <figcaption className="mt-1 font-mono text-[11px] text-ash">{props.aspect}</figcaption>
    </figure>
  )
}

/**
 * What the platform receives. A post goes out as it was approved, so its
 * parts are only shown. A draft is a form; anything else reads as text with
 * the lines around its description.
 */
function BlockText(props: {
  publication: Publication
  editable: boolean
  edit: DraftEdit | undefined
  onEdit: (edit: DraftEdit | null) => void
}) {
  const publication = props.publication
  if (publication.parts !== undefined) {
    return (
      <>
        <PostParts parts={publication.parts} className="text-sm" />
        <NothingAppended />
      </>
    )
  }
  if (props.editable) return <DraftForm publication={publication} edit={props.edit} onEdit={props.onEdit} />
  if (publication.platform === 'x') {
    return (
      <>
        <p className="whitespace-pre-line">{publication.title}</p>
        <NothingAppended />
      </>
    )
  }
  return (
    <>
      <p className="font-medium">{publication.title}</p>
      {publication.body && <p className="whitespace-pre-line text-graphite">{publication.body}</p>}
      <FooterLines footer={publication.footer} sent={publication.sent} />
    </>
  )
}

/**
 * A draft's title and, away from X, the persona's own description, each with
 * its limit counted as the operator types. Save sends this block alone; a
 * refusal shows under it in a live region that stays mounted, and while it
 * shows, the block's fields are marked invalid and described by it. Discard
 * drops the edit and puts focus back in the title, since the button it was on
 * leaves the page.
 */
function DraftForm(props: { publication: Publication; edit: DraftEdit | undefined; onEdit: (edit: DraftEdit | null) => void }) {
  const updateDraft = useMutation(api.private.publications.updateDraft)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const id = React.useId()
  const titleId = `${id}-title`
  const bodyId = `${id}-body`
  const errorId = `${id}-error`
  const publication = props.publication
  const onX = publication.platform === 'x'
  // No unsaved edit means the block shows what is saved.
  const draft = props.edit === undefined ? savedDraft(publication) : props.edit
  const dirty = props.edit !== undefined && differs(publication, props.edit)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setState({ status: 'saving' })
    try {
      // X posts the title alone and takes no description, so none is sent there rather than an empty one.
      if (onX) await updateDraft({ publicationId: publication._id, title: draft.title })
      else await updateDraft({ publicationId: publication._id, title: draft.title, body: draft.body })
      props.onEdit(null)
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const change = (next: Partial<DraftEdit>) => props.onEdit({ ...draft, ...next })
  // A refusal names its field in words only, so while one shows every field of the block is marked and described by it.
  const refused = state.status === 'error'
  const fieldProps = (describedBy: string) => ({
    'aria-invalid': refused,
    'aria-describedby': refused ? `${describedBy} ${errorId}` : describedBy,
  })
  const discard = () => {
    props.onEdit(null)
    setState({ status: 'idle' })
    document.getElementById(titleId)?.focus()
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      {onX ? (
        <CountedField id={titleId} label="Post text" length={xLength(draft.title)} limit={X_POST_LIMIT}>
          <Textarea
            id={titleId}
            {...fieldProps(`${titleId}-counter ${titleId}-note`)}
            value={draft.title}
            onChange={(event) => change({ title: event.target.value })}
            className="min-h-20"
          />
          <NothingAppended id={`${titleId}-note`} />
        </CountedField>
      ) : (
        <>
          <CountedField id={titleId} label="Title" length={Array.from(draft.title).length} limit={PUBLICATION_TITLE_MAX}>
            <Input
              id={titleId}
              {...fieldProps(`${titleId}-counter`)}
              value={draft.title}
              onChange={(event) => change({ title: event.target.value })}
            />
          </CountedField>
          <CountedField id={bodyId} label="Description" length={Array.from(draft.body).length} limit={PUBLICATION_BODY_MAX}>
            <Textarea
              id={bodyId}
              {...fieldProps(`${bodyId}-counter`)}
              value={draft.body}
              onChange={(event) => change({ body: event.target.value })}
              className="min-h-24"
            />
          </CountedField>
          <FooterLines footer={publication.footer} sent={publication.sent} />
        </>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" busy={state.status === 'saving'} disabled={!dirty}>
          Save
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={discard}>
            Discard
          </Button>
        )}
      </div>
      <div id={errorId} aria-live="polite">
        {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      </div>
    </form>
  )
}

/** A field's label with its counter on one row, the way the post editor lays out a part. The field's id names the counter. */
function CountedField(props: { id: string; label: string; length: number; limit: number; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={props.id} className="text-xs font-medium text-graphite">
          {props.label}
        </label>
        <CharacterCounter id={`${props.id}-counter`} length={props.length} limit={props.limit} />
      </div>
      {props.children}
    </div>
  )
}

/**
 * The lines dispatch adds around the persona's description: the disclosure
 * above it, then the Formstep line, the code, and the tracked link or "Link
 * in bio." below. Until a publication goes out the backend composes them with
 * the code in force now, so a code given or retired shows here at once; once
 * it went out, with the code it carried. The backend decides which (`sent`),
 * so this label and the code under it follow one rule: a failed publication
 * has not gone out, and a retry composes it again. Only X has no footer, and
 * an X block never draws this, so a missing footer here is a backend bug and
 * says so.
 */
function FooterLines(props: { footer: Footer | null; sent: boolean }) {
  if (props.footer === null) return <ErrorLine>The lines added to this description are missing.</ErrorLine>
  return (
    <div className="rounded-lg bg-paper-warm px-3 py-2.5 text-xs leading-relaxed text-graphite">
      <p className="mb-1 text-[11px] font-medium text-ash">{props.sent ? 'Added when it went out' : 'Added when it goes out'}</p>
      <FooterText lines={props.footer.above} />
      <p className="my-1 text-ash italic">The description</p>
      <FooterText lines={props.footer.below} />
    </div>
  )
}

function FooterText(props: { lines: string[] }) {
  return props.lines.map((line, index) => (
    // Composed in a fixed order and never edited, so a line's position is its identity.
    <p key={index} className={cn('break-words', { 'font-mono text-[11px]': /^https?:\/\//.test(line) })}>
      {line}
    </p>
  ))
}

function NothingAppended(props: { id?: string }) {
  return (
    <p id={props.id} className="text-xs text-ash">
      Nothing is appended on X.
    </p>
  )
}

/** The codes stamped on the publications that already went out, whatever is in force now. */
function CodesSent(props: { codes: { code: string; offer: string }[] }) {
  return (
    <p className="mt-1 text-sm">
      Went out with code{' '}
      {props.codes.map((code, index) => (
        <React.Fragment key={code.code}>
          {index > 0 && ', '}
          <Mono>{code.code}</Mono> <span className="text-ash">({code.offer})</span>
        </React.Fragment>
      ))}
    </p>
  )
}

/** The saved title and description as the form holds them. A publication saved without a description of its own edits as empty text. */
function savedDraft(publication: Publication): DraftEdit {
  return { title: publication.title, body: publication.body === undefined ? '' : publication.body }
}

function differs(publication: Publication, edit: DraftEdit): boolean {
  const saved = savedDraft(publication)
  return edit.title !== saved.title || edit.body !== saved.body
}

/** "YouTube", "YouTube and TikTok", "YouTube, TikTok and Instagram". */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}
