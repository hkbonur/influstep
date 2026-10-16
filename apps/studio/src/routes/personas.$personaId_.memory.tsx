import { api } from '@influstep/convex/_generated/api'
import type { Doc, Id } from '@influstep/convex/_generated/dataModel'
import { MEMORY_TEXT_MAX, isRetirable, memoryTextProblem, type MemoryKind, type OperatorMemoryKind } from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { Button, ErrorLine, Field, type FormState, Input, LinkButton, PageHeader, Skeleton } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { splitBrief } from '@/lib/research'
import { ACTOR_WORDS } from '@/lib/strategy'

// `$personaId_`: the same /personas/:id/memory address, outside the persona page's route, like the strategy and voice
// pages. The persona page renders no outlet, so a route nested under it would show the persona page and never this one.
export const Route = createFileRoute('/personas/$personaId_/memory')({ component: MemoryPage })

/*
 * Where the page reads from (docs/plan.md v0.2, slice 10):
 * - private.personas.get: the persona's name and its episodes, whose titles name an entry's evidence.
 * - private.experiments.list for the persona: the names of the experiments an entry points at.
 * - private.memory.list: `entries`, every memories row of the persona newest first (of the briefs only the one in
 *   force), `signals`, the id and title of each signal an entry names, and `messages`, the chat messages an entry was
 *   told in.
 */
type MemoryData = NonNullable<FunctionReturnType<typeof api.private.memory.list>>
type Entry = MemoryData['entries'][number]

/** What an entry's evidence can name, by id. */
interface EvidenceNames {
  experiments: Map<Id<'experiments'>, string>
  episodes: Map<Id<'episodes'>, string>
  signals: Map<Id<'signals'>, string>
  messages: Map<Id<'messages'>, MemoryData['messages'][number]>
}

/** The page's sections, top to bottom: what the operator told first, then what the agents keep. */
const SECTIONS: { kind: MemoryKind; title: string; empty: (name: string) => string }[] = [
  { kind: 'rule', title: 'Rules', empty: (name) => `No rules. Add one above, or tell ${name} in the chat: "remember to …".` },
  { kind: 'fact', title: 'Facts', empty: (name) => `No facts. Add one above, or tell ${name} in the chat: "remember that …".` },
  {
    kind: 'learning',
    title: 'Learnings',
    empty: () => 'Nothing learned yet. Each decided experiment and each change a review makes leaves one.',
  },
  { kind: 'goal_note', title: 'Goal notes', empty: () => 'No goal note yet. Every strategy review leaves one.' },
  { kind: 'problem', title: 'Problems', empty: () => 'No open problems.' },
  { kind: 'brief', title: 'Morning brief', empty: () => 'No brief in force. The researcher writes one every morning.' },
]

/** What retiring an entry is called, by kind: the operator forgets a fact or a rule and resolves a problem. */
const RETIRE_WORDS: Partial<Record<MemoryKind, { action: string; done: string }>> = {
  fact: { action: 'Forget', done: 'forgotten' },
  rule: { action: 'Forget', done: 'forgotten' },
  problem: { action: 'Resolve', done: 'resolved' },
}

/**
 * A persona's memory (DESIGN.md, Memory page): what it was told, what it
 * learned and what it keeps meeting, each entry with who wrote it and what it
 * rests on. Replaced and retired entries stay under Earlier, so the persona
 * can show why it believes what it does. One column, read top to bottom.
 */
function MemoryPage() {
  const params = Route.useParams()
  const personaId = params.personaId as Id<'personas'>
  const data = useQuery(api.private.personas.get, { personaId })
  const memory = useQuery(api.private.memory.list, { personaId })
  const experiments = useQuery(api.private.experiments.list, { personaId })
  if (data === null || memory === null) return <p className="text-ash">This persona does not exist.</p>
  if (data === undefined || memory === undefined || experiments === undefined) return <Skeleton className="h-96" />
  const persona = data.persona
  const names: EvidenceNames = {
    experiments: new Map(experiments.map((experiment) => [experiment._id, experiment.name])),
    episodes: new Map(data.episodes.map((episode) => [episode._id, episode.title])),
    signals: new Map(memory.signals.map((signal) => [signal._id, signal.title])),
    messages: new Map(memory.messages.map((message) => [message._id, message])),
  }
  return (
    <div className="max-w-[48rem]">
      <PageHeader
        title={`Memory of ${persona.name}`}
        lead="What the writer reads before every script and post."
        actions={
          <>
            <LinkButton to="/personas/$personaId/strategy" params={{ personaId }} size="sm" variant="ghost">
              Strategy
            </LinkButton>
            <LinkButton to="/personas/$personaId" params={{ personaId }} size="sm" variant="ghost">
              Open persona
            </LinkButton>
          </>
        }
      />
      <div className="space-y-10">
        <RememberForm persona={persona} />
        {SECTIONS.map((section) => (
          <MemorySection
            key={section.kind}
            title={section.title}
            empty={section.empty(persona.name)}
            entries={memory.entries.filter((entry) => entry.kind === section.kind)}
            persona={persona}
            names={names}
          />
        ))}
      </div>
    </div>
  )
}

function SectionHeading(props: { children: React.ReactNode }) {
  return <h2 className="eyebrow mb-3">{props.children}</h2>
}

/** Add a rule or a fact, as the chat's "remember …" does. The same words already remembered are refused. */
function RememberForm(props: { persona: Doc<'personas'> }) {
  const add = useMutation(api.private.memory.add)
  const [kind, setKind] = React.useState<OperatorMemoryKind>('rule')
  const [text, setText] = React.useState('')
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (state.status === 'saving') return
    const problem = memoryTextProblem(text)
    if (problem !== null) {
      setState({ status: 'error', message: problem })
      return
    }
    setState({ status: 'saving' })
    try {
      await add({ personaId: props.persona._id, kind, text })
      setText('')
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <section>
      <SectionHeading>Remember</SectionHeading>
      <form onSubmit={(event) => void submit(event)} className="grid gap-3 sm:grid-cols-[9rem_1fr_auto] sm:items-end">
        <Field label="Kind">
          <select name="kind" className="field" value={kind} onChange={(event) => setKind(event.target.value === 'fact' ? 'fact' : 'rule')}>
            <option value="rule">Rule</option>
            <option value="fact">Fact</option>
          </select>
        </Field>
        <Field label={kind === 'rule' ? 'What the writer must always or never do' : 'What the persona should know'}>
          <Input
            name="text"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              // The refusal was about the words sent; new words make it stale.
              if (state.status === 'error') setState({ status: 'idle' })
            }}
            placeholder={kind === 'rule' ? 'Never say "guys".' : 'Most viewers run n8n self-hosted.'}
            aria-describedby="remember-count"
          />
        </Field>
        <Button type="submit" variant="primary" busy={state.status === 'saving'}>
          Remember
        </Button>
      </form>
      <p id="remember-count" className="mt-1.5 text-xs text-ash">
        <span className="tabular">
          {text.trim().length} / {MEMORY_TEXT_MAX}
        </span>
        . Kept until you forget it.
      </p>
      {state.status === 'error' && (
        <div className="mt-2">
          <ErrorLine>{state.message}</ErrorLine>
        </div>
      )}
    </section>
  )
}

/** One kind: the entries in force, newest first, then the replaced and retired ones under Earlier. */
function MemorySection(props: { title: string; empty: string; entries: Entry[]; persona: Doc<'personas'>; names: EvidenceNames }) {
  const active = props.entries.filter((entry) => entry.status === 'active')
  const earlier = props.entries.filter((entry) => entry.status !== 'active')
  return (
    <section>
      <SectionHeading>{props.title}</SectionHeading>
      {active.length === 0 && <p className="text-ash">{props.empty}</p>}
      {active.length > 0 && (
        <ul className="space-y-3">
          {active.map((entry) => (
            <EntryRow key={entry._id} entry={entry} persona={props.persona} names={props.names} />
          ))}
        </ul>
      )}
      {earlier.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-ash hover:text-ink">
            Earlier <span className="tabular">({earlier.length})</span>
          </summary>
          <ul className="mt-3 space-y-3">
            {earlier.map((entry) => (
              <EntryRow key={entry._id} entry={entry} persona={props.persona} names={props.names} />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function EntryRow(props: { entry: Entry; persona: Doc<'personas'>; names: EvidenceNames }) {
  const entry = props.entry
  return (
    <li className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        {entry.kind === 'brief' ? <BriefText text={entry.text} /> : <p>{entry.text}</p>}
        <p className="mt-0.5 text-[11px] text-ash">
          {formatDate(entry.createdAt)} · {ACTOR_WORDS[entry.actor]}
          <StatusWords entry={entry} />
        </p>
        <EvidenceLinks entry={entry} persona={props.persona} names={props.names} />
      </div>
      {entry.status === 'active' && isRetirable(entry.kind) && <RetireButton entry={entry} />}
    </li>
  )
}

/** What happened to an entry no longer in force: a newer one replaced it, or the operator retired it. */
function StatusWords(props: { entry: Entry }) {
  const entry = props.entry
  if (entry.status === 'active') return null
  if (entry.status === 'superseded') return <> · replaced by a newer one</>
  const words = RETIRE_WORDS[entry.kind]
  if (words === undefined) throw new Error(`a ${entry.kind} entry was retired, which only the operator does to a fact, a rule or a problem`)
  return (
    <>
      {' · '}
      {words.done}
      {entry.retiredAt !== undefined && ` ${formatDate(entry.retiredAt)}`}
    </>
  )
}

/**
 * Forget a fact or a rule, or resolve a problem. The entry moves to Earlier,
 * so the click needs no confirm step: the operator can tell it again. A
 * refusal shows beside the button.
 */
function RetireButton(props: { entry: Entry }) {
  const retire = useMutation(api.private.memory.retire)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const words = RETIRE_WORDS[props.entry.kind]
  if (words === undefined) return null
  const click = async () => {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      await retire({ memoryId: props.entry._id })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button size="sm" variant="ghost" busy={state.status === 'saving'} onClick={() => void click()}>
        {words.action}
      </Button>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
    </div>
  )
}

/**
 * What an entry rests on, as links: the chat message it was told in, the
 * experiment, the episodes and the signals. One no longer there shows nothing.
 * A signal links the Signals page, filtered to the persona, and the message
 * the persona page, where the chat is.
 */
function EvidenceLinks(props: { entry: Entry; persona: Doc<'personas'>; names: EvidenceNames }) {
  const evidence = props.entry.evidence
  const message = evidence.messageId === undefined ? undefined : props.names.messages.get(evidence.messageId)
  const experimentName = evidence.experimentId === undefined ? undefined : props.names.experiments.get(evidence.experimentId)
  const episodes = evidence.episodeIds.flatMap((episodeId) => {
    const title = props.names.episodes.get(episodeId)
    return title === undefined ? [] : [{ episodeId, title }]
  })
  const signals = evidence.signalIds.flatMap((signalId) => {
    const title = props.names.signals.get(signalId)
    return title === undefined ? [] : [{ signalId, title }]
  })
  if (message === undefined && experimentName === undefined && episodes.length === 0 && signals.length === 0) return null
  const linkClass = 'underline decoration-fog hover:text-ink hover:decoration-ink'
  const count = (message === undefined ? 0 : 1) + (experimentName === undefined ? 0 : 1) + episodes.length + signals.length
  // Folded: the sentence and who wrote it are what the operator reads; the evidence is there to check it.
  return (
    <details className="mt-1 text-[11px] text-ash">
      <summary className="w-fit cursor-pointer hover:text-ink">
        Evidence <span className="tabular">({count})</span>
      </summary>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {message !== undefined && (
          <Link to="/personas/$personaId" params={{ personaId: props.persona._id }} className={linkClass}>
            You said in the chat, {formatDate(message.createdAt)}: "{message.text}"
          </Link>
        )}
        {experimentName !== undefined && (
          <Link to="/experiments" className={linkClass}>
            {experimentName}
          </Link>
        )}
        {episodes.map((episode) => (
          <Link key={episode.episodeId} to="/episodes/$episodeId" params={{ episodeId: episode.episodeId }} className={linkClass}>
            {episode.title}
          </Link>
        ))}
        {signals.map((signal) => (
          <Link key={signal.signalId} to="/signals" search={{ persona: props.persona._id }} className={linkClass}>
            {signal.title}
          </Link>
        ))}
      </p>
    </details>
  )
}

/** A brief is written line by line: its first lines, and the rest folded under them, as on the persona page. */
function BriefText(props: { text: string }) {
  const lines = splitBrief(props.text)
  return (
    <div>
      {lines.head.map((line, index) => (
        // The brief's lines never move, so their place keys them; a line can repeat.
        <p key={`${index}:${line}`}>{line}</p>
      ))}
      {lines.rest.length > 0 && (
        <details className="mt-1">
          <summary className="w-fit cursor-pointer text-xs text-ash hover:text-ink">Whole brief</summary>
          <div className="mt-1">
            {lines.rest.map((line, index) => (
              <p key={`${index}:${line}`}>{line}</p>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
