import { api } from '@influstep/convex/_generated/api'
import type { Doc } from '@influstep/convex/_generated/dataModel'
import { useMutation } from 'convex/react'
import React from 'react'
import { Button, ErrorLine, Field, Input, Textarea } from './ui'

const EDITABLE = new Set<Doc<'episodes'>['status']>(['idea', 'scripted', 'waiting_on_you', 'failed'])

/** Hook, body, sponsor segment, call to action. Saves as one script; the hook is also the episode's hook. */
export function ScriptEditor(props: { episode: Doc<'episodes'>; sponsorName: string }) {
  const update = useMutation(api.private.episodes.updateScript)
  const [title, setTitle] = React.useState(props.episode.title)
  const [script, setScript] = React.useState(props.episode.script)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [savedAt, setSavedAt] = React.useState<number | null>(null)
  const locked = !EDITABLE.has(props.episode.status)
  const dirty = title !== props.episode.title || JSON.stringify(script) !== JSON.stringify(props.episode.script)
  const words = Object.values(script).join(' ').split(/\s+/).filter(Boolean).length

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await update({ episodeId: props.episode._id, title, script })
      setSavedAt(Date.now())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  const set = (key: keyof typeof script) => (event: React.ChangeEvent<HTMLTextAreaElement>) =>
    setScript((current) => ({ ...current, [key]: event.target.value }))

  return (
    <form onSubmit={save} className="grid gap-4">
      <Field label="Title">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} disabled={locked} />
      </Field>
      <Field label="Hook" hint="First sentence; the experiment's unit when a hook experiment runs.">
        <Textarea value={script.hook} onChange={set('hook')} disabled={locked} className="min-h-14" />
      </Field>
      <Field label="Body">
        <Textarea value={script.body} onChange={set('body')} disabled={locked} className="min-h-40" />
      </Field>
      <Field
        label={`Sponsor segment (${props.sponsorName})`}
        hint={props.episode.sponsorSegment === 'none' ? 'This episode carries no sponsor; leave it empty.' : undefined}
      >
        <Textarea value={script.sponsor} onChange={set('sponsor')} disabled={locked} className="min-h-14" />
      </Field>
      <Field label="Call to action">
        <Textarea value={script.cta} onChange={set('cta')} disabled={locked} className="min-h-14" />
      </Field>
      <div className="flex items-center gap-3">
        {!locked && (
          <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>
            Save script
          </Button>
        )}
        <span className="tabular text-xs text-ash">
          {words} words, about {Math.max(2, Math.round(words / 2.4))} s spoken
          {locked && ' · locked once recording starts'}
          {savedAt && !dirty && ' · saved'}
        </span>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </form>
  )
}
