import { api } from '@influstep/convex/_generated/api'
import type { Doc, Id } from '@influstep/convex/_generated/dataModel'
import { AGENT_ROLE_LABELS, parseChatIntent } from '@influstep/shared'
import { Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import React from 'react'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { PersonaAvatar } from './persona-avatar'
import { Button, ErrorLine, Eyebrow, type FormState, Spinner } from './ui'

type ChatEpisode = Pick<Doc<'episodes'>, '_id' | 'title'>
type ChatJob = Pick<Doc<'jobs'>, '_id' | 'status' | 'role'>

/**
 * The persona's chat (DESIGN.md, Chat): operator right on paper-warm, persona
 * left with a hairline and its still avatar. Every message is read by the
 * persona, which answers with what it did: a reply that changed an episode
 * links to it, and one that handed a task to an agent shows the task's state
 * until the answer arrives as its own message. Active directives sit pinned
 * above the composer.
 */
export function PersonaChat(props: {
  persona: Doc<'personas'>
  messages: Doc<'messages'>[]
  directives: Doc<'directives'>[]
  /** Every episode of the persona, for the titles of the episodes a reply links to. */
  episodes: ChatEpisode[]
  /** The persona's newest jobs, for the state of the tasks a reply handed to an agent. */
  jobs: ChatJob[]
}) {
  const send = useMutation(api.private.personas.sendMessage)
  const withdraw = useMutation(api.private.personas.withdrawDirective)
  const [text, setText] = React.useState('')
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const endRef = React.useRef<HTMLDivElement>(null)
  const count = props.messages.length
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [count])

  const submit = async () => {
    const value = text.trim()
    if (!value) return
    setState({ status: 'saving' })
    try {
      await send({ personaId: props.persona._id, text: value })
      setText('')
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }

  // The persona decides what a message is once it reads it; the shared parser only says how it reads in plain English.
  const readsAsDirective = parseChatIntent(text).kind === 'directive'

  return (
    <section className="flex min-h-0 flex-col" aria-label="Chat">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {props.messages.length === 0 && (
          <p className="text-ash">
            Say what you want from {props.persona.name}: ask a question, give a rule (“never mention pricing”), change the plan (“move
            Friday to Saturday”), or ask for a research brief, a comment digest or an analytics summary. A rule becomes a directive every
            agent reads until you withdraw it.
          </p>
        )}
        {props.messages.map((message) => (
          <ChatMessage key={message._id} message={message} persona={props.persona} episodes={props.episodes} jobs={props.jobs} />
        ))}
        <div ref={endRef} />
      </div>

      {props.directives.length > 0 && (
        <div className="mt-3 border-t border-mist pt-3">
          <Eyebrow className="mb-1.5">Directives in force</Eyebrow>
          <ul className="space-y-1">
            {props.directives.map((directive) => (
              <li key={directive._id} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink" />
                <span className="flex-1">{directive.text}</span>
                <button type="button" onClick={() => withdraw({ directiveId: directive._id })} className="text-xs text-ash hover:text-ink">
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void submit()
            }
          }}
          rows={2}
          placeholder={`Message ${props.persona.name}: ask, give a rule, or change the plan`}
          className="field h-auto resize-none py-2 leading-relaxed"
          aria-label="Message"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ash">
            {readsAsDirective ? 'Reads like a directive. Once taken as one, it stays in force until you withdraw it.' : 'Cmd+Enter to send'}
          </span>
          <Button type="submit" variant="primary" size="sm" busy={state.status === 'saving'} disabled={!text.trim()}>
            Send
          </Button>
        </div>
        {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      </form>
    </section>
  )
}

function ChatMessage(props: { message: Doc<'messages'>; persona: Doc<'personas'>; episodes: ChatEpisode[]; jobs: ChatJob[] }) {
  const message = props.message
  const fromOperator = message.author === 'operator'
  // The persona's reply to a directive carries the directive too; the mark stays on the operator's line, where the rule was given.
  const directiveMark = fromOperator && message.directiveId !== undefined
  return (
    <div className={cn('flex items-start gap-2', { 'justify-end': fromOperator })}>
      {/* 10px down puts the 20px avatar's middle on the bubble's first line (1px border, 8px padding, 22.75px line). */}
      {!fromOperator && <PersonaAvatar color={props.persona.color} state="idle" size={20} className="mt-2.5" />}
      <div className={cn('flex max-w-[85%] min-w-0 flex-col gap-0.5', { 'items-end': fromOperator, 'items-start': !fromOperator })}>
        <div
          className={cn('rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap', {
            'bg-paper-warm': fromOperator,
            'border border-mist bg-paper': !fromOperator,
          })}
        >
          {message.text}
          {message.episodeId !== undefined && <EpisodeLink episodeId={message.episodeId} episodes={props.episodes} />}
        </div>
        {/* Stays mounted while the line comes and goes, so each step of the task is announced, never the whole chat again. */}
        {message.jobId !== undefined && (
          <div aria-live="polite">
            <TaskState jobId={message.jobId} jobs={props.jobs} />
          </div>
        )}
        <span className="tabular px-1 font-mono text-[11px] text-ash">
          {fromOperator ? 'You' : `@${props.persona.handle}`} · {formatDateTime(message.createdAt)}
          {directiveMark && ' · directive'}
        </span>
      </div>
    </div>
  )
}

/**
 * The episode a reply changed, by its title. The page loads every episode of
 * the persona, killed ones included, so an id it does not hold names an
 * episode that no longer exists: the link then says only where it goes.
 */
function EpisodeLink(props: { episodeId: Id<'episodes'>; episodes: ChatEpisode[] }) {
  const episode = props.episodes.find((candidate) => candidate._id === props.episodeId)
  return (
    <Link
      to="/episodes/$episodeId"
      params={{ episodeId: props.episodeId }}
      className="mt-1.5 block font-medium whitespace-normal underline decoration-fog underline-offset-2 hover:decoration-ink"
    >
      {episode === undefined ? 'Open the episode' : episode.title}
    </Link>
  )
}

/**
 * Where a task a reply handed to an agent stands while it waits or runs, with
 * a quiet spinner. Once the job finishes, its answer, or why it could not
 * finish, arrives as a message of its own, so nothing more shows here then.
 */
function TaskState(props: { jobId: Id<'jobs'>; jobs: ChatJob[] }) {
  const job = props.jobs.find((candidate) => candidate._id === props.jobId)
  // The page holds only the persona's newest jobs. A task runs on the backend within seconds of the reply, so one that
  // has dropped out of that list finished long ago, and a finished task shows nothing here anyway.
  if (job === undefined) return null
  if (job.status === 'done' || job.status === 'failed') return null
  const role = AGENT_ROLE_LABELS[job.role].toLowerCase()
  return (
    <p className="flex items-center gap-1.5 px-1 text-xs text-ash">
      <Spinner />
      {job.status === 'running' ? `The ${role} is on it` : `Queued for the ${role}`}
    </p>
  )
}
