import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import { REPLY_ORIGIN_LABELS, X_POST_LIMIT, repliesLeft, replyProblems, xLength } from '@influstep/shared'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { CharacterCounter } from '@/components/character-counter'
import { ReplyStatusPill } from '@/components/status'
import { Button, Empty, ErrorLine, type FormState, LinkButton, MockNote, PageHeader, Skeleton, Textarea } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { formatCount, plural, relativeTime } from '@/lib/format'

// `$personaId_`: the same /personas/:id/replies address, outside the persona page's route, like the memory and assets
// pages. The persona page renders no outlet, so a route nested under it would show the persona page and never this one.
export const Route = createFileRoute('/personas/$personaId_/replies')({ component: RepliesPage })

/*
 * Where the page reads from (docs/plan.md v0.2, slice 11):
 * - private.replies.list: the persona's name, handle and publishing setting, and for a persona on X today's reply
 *   budget and how much of it went out, then its replies by where they stand: `waiting` (drafts, the author with the
 *   most followers first), `goingOut` (sending, queued, being written), `failed`, and the newest 30 `sent` and
 *   `skipped`.
 */
type RepliesData = NonNullable<FunctionReturnType<typeof api.private.replies.list>>
type OnX = Extract<RepliesData, { onX: true }>
type Reply = OnX['waiting'][number]

/**
 * A persona's replies on X (DESIGN.md, Replies page): what waits for the
 * operator to post, one click per reply, what goes out on its own, what went
 * out and what it brought back, and what the persona passed on and why. One
 * column, read top to bottom.
 */
function RepliesPage() {
  const params = Route.useParams()
  const personaId = params.personaId as Id<'personas'>
  const data = useQuery(api.private.replies.list, { personaId })
  if (data === null) return <p className="text-ash">This persona does not exist.</p>
  if (data === undefined) return <Skeleton className="h-96" />
  const persona = data.persona
  return (
    <div className="max-w-[48rem]">
      <PageHeader
        title={`Replies of ${persona.name}`}
        lead={
          data.onX
            ? `A reply to a stranger's post waits for you. A reply to someone who engaged first goes out on its own when ${persona.name} publishes on its own.`
            : undefined
        }
        actions={
          <>
            <LinkButton to="/personas/$personaId/memory" params={{ personaId }} size="sm" variant="ghost">
              Memory
            </LinkButton>
            <LinkButton to="/personas/$personaId" params={{ personaId }} size="sm" variant="ghost">
              Open persona
            </LinkButton>
          </>
        }
      />
      {!data.onX && (
        <Empty
          action={
            <LinkButton to="/personas/$personaId" params={{ personaId }}>
              Open persona
            </LinkButton>
          }
        >
          {persona.name} is not on X, and replies are for X. Give it X in the persona's settings to let it answer posts there.
        </Empty>
      )}
      {data.onX && <Replies data={data} />}
    </div>
  )
}

function Replies(props: { data: OnX }) {
  const data = props.data
  const persona = data.persona
  // One status line for the page: posting, skipping or asking moves the card the button sat in to another section.
  const statusRef = React.useRef<HTMLParagraphElement>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const onDone = (message: string) => {
    setStatus(message)
    statusRef.current?.focus()
  }
  const all = [...data.waiting, ...data.goingOut, ...data.failed, ...data.sent, ...data.skipped]
  return (
    <div className="space-y-10">
      <BudgetLine data={data} />
      <p ref={statusRef} tabIndex={-1} aria-live="polite" className={status === null ? 'outline-none' : '-mt-6 text-xs outline-none'}>
        {status}
      </p>

      <section>
        <SectionHeading count={data.waiting.length}>Waiting for you</SectionHeading>
        {data.waiting.length === 0 && (
          <p className="text-ash">Nothing waits for you. The listener looks for posts to answer every three hours.</p>
        )}
        <ul className="divide-y divide-mist border-y border-mist">
          {data.waiting.map((reply) => (
            <li key={reply._id} className="py-4">
              <ReplyEditor reply={reply} action="Post reply" onDone={onDone} />
            </li>
          ))}
        </ul>
      </section>

      {data.failed.length > 0 && (
        <section>
          <SectionHeading count={data.failed.length}>Failed</SectionHeading>
          <ul className="divide-y divide-mist border-y border-mist">
            {data.failed.map((reply) => (
              <li key={reply._id} className="space-y-3 py-4">
                {reply.error && <ErrorLine>{reply.error}</ErrorLine>}
                <ReplyEditor reply={reply} action="Post again" onDone={onDone} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionHeading count={data.goingOut.length}>Going out</SectionHeading>
        {data.goingOut.length === 0 && (
          <p className="text-ash">
            {persona.autoPublish
              ? 'Nothing going out. A reply to someone who mentioned or answered the persona goes out on its own, within the budget.'
              : `Nothing going out. ${persona.name} publishes nothing on its own, so every reply waits for you.`}
          </p>
        )}
        <ul className="divide-y divide-mist border-y border-mist">
          {data.goingOut.map((reply) => (
            <li key={reply._id} className="py-4">
              <GoingOutRow reply={reply} onDone={onDone} />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionHeading count={data.sent.length}>Sent</SectionHeading>
        {data.sent.length === 0 && <p className="text-ash">No replies sent yet.</p>}
        <ul className="divide-y divide-mist border-y border-mist">
          {data.sent.map((reply) => (
            <li key={reply._id} className="py-4">
              <SentRow reply={reply} />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionHeading count={data.skipped.length}>Skipped</SectionHeading>
        {data.skipped.length === 0 && <p className="text-ash">Nothing skipped.</p>}
        <ul className="divide-y divide-mist border-y border-mist">
          {data.skipped.map((reply) => (
            <li key={reply._id} className="py-4">
              <SkippedRow reply={reply} onDone={onDone} />
            </li>
          ))}
        </ul>
      </section>

      <MockNote when={all.some((reply) => reply.mock)}>
        Mock listener: these posts are generated, not heard on X, and a sent reply's numbers are generated, not measured.
      </MockNote>
    </div>
  )
}

function SectionHeading(props: { count: number; children: React.ReactNode }) {
  return (
    <h2 className="eyebrow mb-3">
      {props.children} <span className="tabular">({props.count})</span>
    </h2>
  )
}

/**
 * Today's budget in one line, and Listen now, which looks for posts at once
 * instead of at the next three-hour sweep. A refusal (a budget of 0) shows
 * under it.
 */
function BudgetLine(props: { data: OnX }) {
  const listenNow = useMutation(api.private.replies.listenNow)
  const [state, setState] = React.useState<FormState | { status: 'done' }>({ status: 'idle' })
  const data = props.data
  const left = repliesLeft(data.budget, data.sentToday)
  const listen = async () => {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      await listenNow({ personaId: data.persona._id })
      setState({ status: 'done' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm">
          {data.budget === 0 ? (
            "Replies are off: the reply budget is 0. Raise it in the persona's settings."
          ) : (
            <>
              <span className="tabular">{data.sentToday}</span> of <span className="tabular">{data.budget}</span>{' '}
              {plural(data.budget, 'reply', 'replies')} sent today
              <span className="text-ash">
                {' · '}
                <span className="tabular">{left}</span> left
              </span>
            </>
          )}
        </p>
        <Button size="sm" busy={state.status === 'saving'} onClick={() => void listen()}>
          Listen now
        </Button>
      </div>
      <div aria-live="polite">
        {state.status === 'done' && <p className="text-xs text-ash">Listening. New drafts show up under Waiting for you.</p>}
        {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      </div>
    </section>
  )
}

/**
 * The post a reply answers, quoted: who wrote it and how many follow them,
 * where it came from, when it was posted, and a link to it on X.
 */
function TargetPost(props: { reply: Reply }) {
  const target = props.reply.target
  return (
    <div className="border-l-2 border-mist pl-3">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-ash">
        <span className="font-medium text-graphite">{target.author.name}</span>
        <span className="font-mono">@{target.author.handle}</span>
        <span>
          <span className="tabular">{formatCount(target.author.followers)}</span> followers
        </span>
        <span>· {REPLY_ORIGIN_LABELS[props.reply.origin]}</span>
        {props.reply.pillar && <span>· {props.reply.pillar}</span>}
        {/* A reply heard during a reply experiment carries the variant it tests (Experiments page). */}
        {props.reply.variant && <span>· testing {props.reply.variant.label}</span>}
        <a href={target.url} target="_blank" rel="noreferrer" className="underline decoration-fog hover:text-ink hover:decoration-ink">
          {relativeTime(target.postedAt)}
        </a>
      </p>
      <p className="mt-1 text-sm whitespace-pre-line text-graphite">{target.text}</p>
    </div>
  )
}

type EditorAction = 'post' | 'skip'
type EditorState = { status: 'idle' } | { status: 'saving'; action: EditorAction } | { status: 'error'; message: string }

/**
 * A reply the operator posts: the post it answers, the reply in an editable
 * field counted by X's rule, its problems as the operator types, and one
 * button that posts this reply alone. Skip passes on it.
 */
function ReplyEditor(props: { reply: Reply; action: string; onDone: (message: string) => void }) {
  const post = useMutation(api.private.replies.post)
  const skip = useMutation(api.private.replies.skip)
  const [text, setText] = React.useState(props.reply.text)
  const [state, setState] = React.useState<EditorState>({ status: 'idle' })
  const id = React.useId()
  const counterId = `${id}-counter`
  const problemsId = `${id}-problems`
  // The operator may name the sponsor in a reply they post themselves; the backend checks the same rules again.
  const problems = replyProblems(text, { sponsorName: '', sponsorAllowed: true })
  const author = `@${props.reply.target.author.handle}`
  const run = async (action: EditorAction, send: () => Promise<unknown>, done: string) => {
    if (state.status === 'saving') return
    setState({ status: 'saving', action })
    try {
      await send()
      setState({ status: 'idle' })
      props.onDone(done)
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <div className="space-y-3">
      <TargetPost reply={props.reply} />
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={id} className="text-xs font-medium text-graphite">
            Reply to {author}
            {props.reply.operatorAsked && <span className="font-normal text-ash"> · you asked for this one</span>}
          </label>
          <CharacterCounter id={counterId} length={xLength(text)} limit={X_POST_LIMIT} />
        </div>
        <Textarea
          id={id}
          value={text}
          aria-describedby={`${counterId} ${problemsId}`}
          aria-invalid={problems.length > 0 || state.status === 'error'}
          onChange={(event) => {
            setText(event.target.value)
            // The refusal was about the words sent; new words make it stale.
            if (state.status === 'error') setState({ status: 'idle' })
          }}
        />
        <ul id={problemsId} aria-live="polite" className="space-y-0.5 text-xs text-signal-red-deep">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          busy={state.status === 'saving' && state.action === 'post'}
          disabled={problems.length > 0}
          onClick={() => void run('post', () => post({ replyId: props.reply._id, text }), `Reply to ${author} handed to the runner.`)}
        >
          {props.action}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          busy={state.status === 'saving' && state.action === 'skip'}
          onClick={() => void run('skip', () => skip({ replyId: props.reply._id }), `Skipped ${author}'s post.`)}
        >
          Skip
        </Button>
      </div>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
    </div>
  )
}

/** Being written, going out on its own within the budget, or with the runner; a queued one can still be skipped. */
function GoingOutRow(props: { reply: Reply; onDone: (message: string) => void }) {
  const skip = useMutation(api.private.replies.skip)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const reply = props.reply
  const click = async () => {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      await skip({ replyId: reply._id })
      setState({ status: 'idle' })
      props.onDone(`Skipped @${reply.target.author.handle}'s post.`)
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <div className="space-y-3">
      <TargetPost reply={reply} />
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-sm">
          {reply.text === '' ? <span className="text-ash italic">Not written yet</span> : reply.text}
        </p>
        <ReplyStatusPill status={reply.status} />
        {reply.status === 'queued' && (
          <Button size="sm" variant="ghost" busy={state.status === 'saving'} onClick={() => void click()}>
            Skip
          </Button>
        )}
      </div>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
    </div>
  )
}

/** A reply on X: what it said, when it went out, and what it brought back once the analyst read it. */
function SentRow(props: { reply: Reply }) {
  const reply = props.reply
  return (
    <div className="space-y-3">
      <TargetPost reply={reply} />
      <div>
        <p className="text-sm">{reply.text}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-ash">
          {reply.url ? (
            <a href={reply.url} target="_blank" rel="noreferrer" className="underline decoration-fog hover:text-ink hover:decoration-ink">
              Sent {relativeTime(reply.sentAt ?? reply.heardAt)}
            </a>
          ) : (
            <span>Sent {relativeTime(reply.sentAt ?? reply.heardAt)}</span>
          )}
          <ReplyCounts reply={reply} />
        </p>
      </div>
    </div>
  )
}

function ReplyCounts(props: { reply: Reply }) {
  const counts = props.reply.counts
  if (counts === undefined) return <span>Not measured yet</span>
  return (
    <>
      <span>
        <span className="tabular font-mono text-graphite">{formatCount(counts.impressions)}</span> seen
      </span>
      <span>
        <span className="tabular font-mono text-graphite">{counts.likes}</span> {plural(counts.likes, 'like', 'likes')}
      </span>
      <span>
        <span className="tabular font-mono text-graphite">{counts.profileVisits}</span> profile{' '}
        {plural(counts.profileVisits, 'visit', 'visits')}
      </span>
      <span>
        <span className="tabular font-mono text-graphite">{counts.follows}</span> {plural(counts.follows, 'follow', 'follows')}
      </span>
    </>
  )
}

/**
 * A post the persona passed on, with why: the writer, a rule, the sponsor
 * filter, the operator or a stale draft. Write a reply asks the writer for
 * one anyway; it waits for the operator once written.
 */
function SkippedRow(props: { reply: Reply; onDone: (message: string) => void }) {
  const ask = useMutation(api.private.replies.ask)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const reply = props.reply
  const click = async () => {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      await ask({ replyId: reply._id })
      setState({ status: 'idle' })
      props.onDone(`The writer is drafting a reply to @${reply.target.author.handle}. It waits for you once written.`)
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <div className="space-y-3">
      <TargetPost reply={reply} />
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-xs text-ash">{reply.skipReason}</p>
        <Button size="sm" busy={state.status === 'saving'} onClick={() => void click()}>
          Write a reply
        </Button>
      </div>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
    </div>
  )
}
