import { api } from '@influstep/convex/_generated/api'
import type { Doc } from '@influstep/convex/_generated/dataModel'
import {
  scriptProblems,
  spokenScript,
  spokenSeconds,
  spokenWordCount,
  textEditable,
  type Beat,
  type EpisodeStatus,
} from '@influstep/shared'
import { useMutation } from 'convex/react'
import React from 'react'
import { errorMessage } from '@/lib/errors'
import { urlHost } from '@/lib/format'
import { Button, ErrorLine, Field, type FormState, Input, Textarea } from './ui'

/** What the operator edits of a beat: its title and what is spoken over it. Its tool and its URL stay the writer's. */
type BeatDraft = Pick<Beat, 'title' | 'voiceover'>

interface ScriptEditorProps {
  episode: Doc<'episodes'>
  sponsorName: string
}

/**
 * A video's script is its beats (CONTEXT.md, "Beat"): the voice track is
 * built from them, so what the operator edits here is what the recording
 * speaks. Before the writer has run there are no beats, and beats are never
 * added here, so the editor says so instead of showing an empty form.
 */
export function ScriptEditor(props: ScriptEditorProps) {
  const beats = props.episode.shotPlan
  if (beats === undefined) return <p className="text-ash">The writer writes the beats when it scripts the episode.</p>
  if (!textEditable(props.episode.status)) return <ScriptReadView episode={props.episode} beats={beats} />
  return <BeatsForm episode={props.episode} beats={beats} sponsorName={props.sponsorName} />
}

/**
 * The title, then one block per beat in order: its number, its title, the
 * line spoken over it and, for a beat the delivery records as a screen, what
 * is on screen. Save sends every beat at once, and the backend refuses with
 * the first script problem, the same list this form shows as the operator
 * types. The page keys the form on the saved beats, so a save that goes
 * through remounts it clean.
 */
function BeatsForm(props: { episode: Doc<'episodes'>; beats: Beat[]; sponsorName: string }) {
  const update = useMutation(api.private.episodes.updateBeats)
  const [title, setTitle] = React.useState(props.episode.title)
  const [drafts, setDrafts] = React.useState<BeatDraft[]>(() =>
    props.beats.map((beat) => ({ title: beat.title, voiceover: beat.voiceover }))
  )
  const [state, setState] = React.useState<FormState>({ status: 'idle' })

  // The writer's tool and URL with the operator's words: what the backend stores, and what the problems are checked against.
  const edited = props.beats.map((beat, index) => ({ ...beat, ...drafts[index] }))
  const dirty =
    title !== props.episode.title ||
    edited.some((beat, index) => beat.title !== props.beats[index]?.title || beat.voiceover !== props.beats[index]?.voiceover)
  const problems = scriptProblems(edited, { sponsorSegment: props.episode.sponsorSegment, sponsorName: props.sponsorName })

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setState({ status: 'saving' })
    try {
      await update({ episodeId: props.episode._id, title, beats: drafts })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const setBeat = (index: number, change: Partial<BeatDraft>) =>
    setDrafts((current) => current.map((beat, at) => (at === index ? { ...beat, ...change } : beat)))

  return (
    <form onSubmit={save} className="grid gap-4">
      <Field label="Title">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <ol className="grid gap-4">
        {edited.map((beat, index) => (
          // Beats are never added, removed or reordered here, so a beat's position is its identity.
          <li key={index}>
            <BeatFields
              index={index}
              beat={beat}
              screen={props.episode.shots[index]?.kind === 'screen'}
              onChange={(change) => setBeat(index, change)}
            />
          </li>
        ))}
      </ol>
      <div>
        {/*
          The live region stays in the page while the list comes and goes, so a screen reader hears each problem as it
          appears and learns why Save is off, and hears a refused save the same way. Not role="status": that reads the
          whole list again on every change.
        */}
        <div aria-live="polite">
          {problems.length > 0 && (
            <ul className="mb-4 space-y-0.5 text-xs text-signal-red-deep">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          {state.status === 'error' && (
            <div className="mb-4">
              <ErrorLine>{state.message}</ErrorLine>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" busy={state.status === 'saving'} disabled={!dirty || problems.length > 0}>
            Save beats
          </Button>
          <SpokenLength beats={edited} lengthSec={props.episode.format?.lengthSec} />
        </div>
      </div>
    </form>
  )
}

function BeatFields(props: { index: number; beat: Beat; screen: boolean; onChange: (change: Partial<BeatDraft>) => void }) {
  const id = React.useId()
  const hookId = `${id}-hook`
  const screenId = `${id}-screen`
  const n = props.index + 1
  // The hook is not a field of its own: the backend takes it from the first beat's first sentence when it saves.
  const opensTheScript = props.index === 0
  const describedBy = [opensTheScript ? hookId : null, props.screen ? screenId : null].filter((part) => part !== null).join(' ')
  return (
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2">
      <span aria-hidden className="tabular pt-2 font-mono text-xs text-ash">
        {n}
      </span>
      <div className="grid gap-1.5">
        <Input
          aria-label={`Beat ${n} title`}
          value={props.beat.title}
          onChange={(event) => props.onChange({ title: event.target.value })}
        />
        <Textarea
          aria-label={`Beat ${n}, spoken`}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          value={props.beat.voiceover}
          onChange={(event) => props.onChange({ voiceover: event.target.value })}
          className="min-h-20"
        />
        {opensTheScript && (
          <p id={hookId} className="text-xs text-ash">
            Its first sentence is the hook.
          </p>
        )}
        {props.screen && (
          <p id={screenId} className="font-mono text-[11px] text-ash">
            On screen: {onScreen(props.beat)}
          </p>
        )}
      </div>
    </div>
  )
}

/** A locked script reads as what the recording speaks: the beats' lines in order, one paragraph each. */
function ScriptReadView(props: { episode: Doc<'episodes'>; beats: Beat[] }) {
  return (
    <div className="grid gap-4">
      <p className="max-w-[65ch] whitespace-pre-line">{spokenScript(props.beats)}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <SpokenLength beats={props.beats} lengthSec={props.episode.format?.lengthSec} />
        <span className="text-xs text-ash">{lockNote(props.episode.status)}</span>
      </div>
    </div>
  )
}

/**
 * How long the beats run spoken, at the writer's pace, against the length the
 * episode was written to. The writer retries a script outside half to one and
 * a half times that length; the operator may trim, so this only informs.
 * An episode written before formats existed has no length to compare with,
 * and the line says only how long it runs.
 */
function SpokenLength(props: { beats: Beat[]; lengthSec: number | undefined }) {
  return (
    <span className="tabular text-xs text-ash">
      {spokenWordCount(props.beats)} words, about {spokenSeconds(props.beats)} s spoken
      {props.lengthSec !== undefined && ` of ${props.lengthSec} s`}
    </span>
  )
}

/** "n8n · app.n8n.cloud": the tool and the host it opens. A URL the browser cannot read shows as the writer wrote it. */
function onScreen(beat: Beat): string {
  const host = urlHost(beat.url)
  return `${beat.tool} · ${host === null ? beat.url : host}`
}

/** Why the script is read only: a killed episode is locked for good; every other lock comes with recording. */
function lockNote(status: EpisodeStatus): string {
  if (status === 'killed') return 'Killed episodes are locked.'
  return 'Locked once recording starts.'
}
