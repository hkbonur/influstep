import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import {
  ASSET_KIND_LABELS,
  ASSET_MAX_BYTES,
  ASSET_NOTE_MAX,
  CLIP_SECONDS,
  MEDIA_KINDS,
  MEDIA_KIND_LABELS,
  assetFileProblem,
  assetNameFromFile,
  assetProblems,
  budgetProblem,
  generationPromptProblem,
  megabytes,
  parseAssetTags,
  type MediaKind,
} from '@influstep/shared'
import { FileTextIcon } from '@phosphor-icons/react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { Button, ErrorLine, Field, type FormState, Input, LinkButton, PageHeader, Skeleton, Textarea } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { formatDate, plural } from '@/lib/format'

// `$personaId_`: the same /personas/:id/assets address, outside the persona page's route, like the memory and strategy
// pages. The persona page renders no outlet, so a route nested under it would show the persona page and never this one.
export const Route = createFileRoute('/personas/$personaId_/assets')({ component: AssetsPage })

/*
 * Where the page reads from (docs/plan.md v0.2, slice 10):
 * - private.assets.list: the persona's name and `assets`, every assets row of the persona newest first, each with
 *   `url` (its file, to preview), `episodeTitle` (the episode the producer made it for), `keptByEpisode` (that
 *   episode's renders are this same file, so deleting the asset keeps it) and `shownIn` (the titles of the scripts
 *   that may still be recorded and show it).
 */
type AssetsData = NonNullable<FunctionReturnType<typeof api.private.assets.list>>
type Asset = AssetsData['assets'][number]
type MediaData = NonNullable<FunctionReturnType<typeof api.private.media.forPersona>>

/** What the file picker offers: the types the library takes (shared `assetKindOf`). */
const ACCEPT = 'image/*,video/*,audio/*,application/pdf,text/*'

/**
 * A persona's asset library (DESIGN.md, Assets page): what the operator
 * uploaded and what the producer made. The writer places an image or a clip
 * in a beat by its name; audio and documents stay in the library.
 */
function AssetsPage() {
  const params = Route.useParams()
  const personaId = params.personaId as Id<'personas'>
  const data = useQuery(api.private.assets.list, { personaId })
  const media = useQuery(api.private.media.forPersona, { personaId })
  // Unset until the operator opens or closes a form, so an empty library can start with Upload open.
  const [open, setOpen] = React.useState<AddForm | 'none' | null>(null)
  if (data === null || media === null) return <p className="text-ash">This persona does not exist.</p>
  if (data === undefined || media === undefined) return <Skeleton className="h-96" />
  const prompts = new Map(media.assetPrompts.map((row) => [row.assetId, row.prompt]))
  const uploads = data.assets.filter((asset) => asset.source === 'operator')
  const made = data.assets.filter((asset) => asset.source === 'producer')
  const adding = open ?? (data.assets.length === 0 ? 'upload' : null)
  const toggle = (form: AddForm) => setOpen(adding === form ? 'none' : form)
  return (
    <div className="max-w-[64rem]">
      <PageHeader
        title={`Assets of ${data.persona.name}`}
        lead="The writer shows an image or a clip in a beat by asking for it by name."
        actions={
          <>
            <Button size="sm" aria-expanded={adding === 'upload'} onClick={() => toggle('upload')}>
              Upload
            </Button>
            <Button size="sm" aria-expanded={adding === 'generate'} onClick={() => toggle('generate')}>
              Generate
            </Button>
            <LinkButton to="/personas/$personaId" params={{ personaId }} size="sm" variant="ghost">
              Open persona
            </LinkButton>
          </>
        }
      />
      <div className="space-y-10">
        {/* The library leads; a form opens only when the operator adds something, or when there is nothing to browse yet. */}
        {adding === 'upload' && <UploadForm personaId={personaId} onClose={() => toggle('upload')} />}
        {adding === 'generate' && <GenerateForm personaId={personaId} media={media} onClose={() => toggle('generate')} />}
        <Generations generations={media.generations} />
        <AssetSection
          title="Your uploads"
          empty="Nothing uploaded yet. A screenshot, a logo or a short clip the writer can show."
          assets={uploads}
          prompts={prompts}
        />
        <AssetSection
          title="Made by the producer"
          empty={`Nothing made yet. Every render, voice track, post card and generated picture of ${data.persona.name} lands here.`}
          assets={made}
          prompts={prompts}
        />
      </div>
    </div>
  )
}

type AddForm = 'upload' | 'generate'

function SectionHeading(props: { children: React.ReactNode }) {
  return <h2 className="eyebrow mb-3">{props.children}</h2>
}

/**
 * Upload a file with the name the writer asks for it by, its tags and a note.
 * The file, the name, the tags and the note are checked with the backend's own
 * words before anything is sent; the name starts as the file's.
 */
function UploadForm(props: { personaId: Id<'personas'>; onClose: () => void }) {
  const generateUploadUrl = useMutation(api.private.assets.generateUploadUrl)
  const add = useMutation(api.private.assets.add)
  const [file, setFile] = React.useState<File | null>(null)
  const [name, setName] = React.useState('')
  const [tags, setTags] = React.useState('')
  const [note, setNote] = React.useState('')
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const fileRef = React.useRef<HTMLInputElement>(null)
  const hintId = React.useId()
  // A refusal was about what was sent; any change makes it stale.
  const edited = () => {
    if (state.status === 'error') setState({ status: 'idle' })
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (state.status === 'saving') return
    if (file === null) {
      setState({ status: 'error', message: 'Choose a file to upload.' })
      return
    }
    const problem =
      assetFileProblem({ contentType: file.type, size: file.size }) ?? assetProblems({ name, tags: parseAssetTags(tags), note })[0]
    if (problem !== undefined && problem !== null) {
      setState({ status: 'error', message: problem })
      return
    }
    setState({ status: 'saving' })
    try {
      const uploadUrl = await generateUploadUrl()
      const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
      if (!response.ok) throw new Error(`The upload failed (${response.status}); try again.`)
      const { storageId } = (await response.json()) as { storageId: Id<'_storage'> }
      const outcome = await add({ personaId: props.personaId, storageId, name, tags: parseAssetTags(tags), note })
      if (outcome.status === 'refused') {
        setState({ status: 'error', message: outcome.message })
        return
      }
      setFile(null)
      setName('')
      setTags('')
      setNote('')
      if (fileRef.current) fileRef.current.value = ''
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <section aria-label="Upload">
      <form onSubmit={(event) => void submit(event)} className="card grid gap-3 sm:grid-cols-2">
        <Field label="File" className="sm:col-span-2">
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept={ACCEPT}
            aria-describedby={hintId}
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null
              setFile(chosen)
              if (chosen !== null) setName(assetNameFromFile(chosen.name))
              edited()
            }}
            className="w-full text-xs text-ash file:mr-3 file:h-7 file:cursor-pointer file:rounded-lg file:border file:border-mist file:bg-paper file:px-2.5 file:text-xs file:font-medium file:text-ink hover:file:bg-paper-tint"
          />
        </Field>
        <Field label="Name the writer asks for">
          <Input
            name="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              edited()
            }}
            placeholder="Pricing page screenshot"
          />
        </Field>
        <Field label="Tags, comma separated">
          <Input
            name="tags"
            value={tags}
            onChange={(event) => {
              setTags(event.target.value)
              edited()
            }}
            placeholder="pricing, screenshot"
          />
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <Input
            name="note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value)
              edited()
            }}
            placeholder="When the writer should show it."
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="primary" busy={state.status === 'saving'}>
            Upload
          </Button>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <p id={hintId} className="text-xs text-ash">
            Images, clips, audio, PDFs and text, up to {megabytes(ASSET_MAX_BYTES)} MB.
          </p>
        </div>
        {state.status === 'error' && (
          <div className="sm:col-span-2">
            <ErrorLine>{state.message}</ErrorLine>
          </div>
        )}
      </form>
    </section>
  )
}

/**
 * One list of the library. Delete removes the card its button sits in, so
 * focus moves to the status line under the heading, which stays mounted and
 * says what became of the asset.
 */
function AssetSection(props: { title: string; empty: string; assets: Asset[]; prompts: Map<Id<'assets'>, string> }) {
  const statusRef = React.useRef<HTMLParagraphElement>(null)
  const [deleted, setDeleted] = React.useState<string | null>(null)
  const onDeleted = (message: string) => {
    setDeleted(message)
    statusRef.current?.focus()
  }
  return (
    <section>
      <SectionHeading>
        {props.title} <span className="tabular">({props.assets.length})</span>
      </SectionHeading>
      <p ref={statusRef} tabIndex={-1} aria-live="polite" className={deleted === null ? 'outline-none' : 'mb-3 text-xs outline-none'}>
        {deleted}
      </p>
      {props.assets.length === 0 && <p className="text-ash">{props.empty}</p>}
      {props.assets.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {props.assets.map((asset) => (
            <AssetCard key={asset._id} asset={asset} prompt={props.prompts.get(asset._id) ?? null} onDeleted={onDeleted} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** One asset: its preview, its name, what it is, its tags and note, and Edit and Delete. */
function AssetCard(props: { asset: Asset; prompt: string | null; onDeleted: (message: string) => void }) {
  const asset = props.asset
  const [editing, setEditing] = React.useState(false)
  // Once an edit is saved or cancelled, focus goes back to Edit, which mounts again with the card's text.
  const [edited, setEdited] = React.useState(false)
  const shownIn = asset.shownIn.length
  return (
    <li className="card flex flex-col gap-3">
      <Preview asset={asset} />
      {editing && (
        <EditForm
          asset={asset}
          onDone={() => {
            setEditing(false)
            setEdited(true)
          }}
        />
      )}
      {!editing && (
        <>
          <div className="min-w-0">
            <p className="font-semibold break-words">{asset.name}</p>
            <p className="mt-0.5 text-[11px] text-ash">
              {ASSET_KIND_LABELS[asset.kind]} · {formatBytes(asset.size)} · {formatDate(asset.createdAt)}
            </p>
            {asset.episodeId !== undefined && asset.episodeTitle !== null && (
              <p className="mt-0.5 text-[11px] text-ash">
                Made for{' '}
                <Link
                  to="/episodes/$episodeId"
                  params={{ episodeId: asset.episodeId }}
                  className="underline decoration-fog hover:text-ink hover:decoration-ink"
                >
                  {asset.episodeTitle}
                </Link>
              </p>
            )}
          </div>
          {asset.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
              {asset.tags.map((tag) => (
                <li key={tag} className="rounded-md bg-paper-warm px-1.5 py-0.5 font-mono text-[11px] text-graphite">
                  {tag}
                </li>
              ))}
            </ul>
          )}
          {asset.note !== '' && <p className="text-xs text-graphite">{asset.note}</p>}
          {shownIn > 0 && (
            <p className="text-[11px] text-ash">
              Shown in {asset.shownIn.map((title) => `"${title}"`).join(', ')}. It stays until{' '}
              {plural(shownIn, 'that episode is', 'those episodes are')} measured or killed.
            </p>
          )}
          {props.prompt !== null && <GenerateAgain assetId={asset._id} />}
          <CardActions asset={asset} focusEdit={edited} onEdit={() => setEditing(true)} onDeleted={props.onDeleted} />
        </>
      )}
    </li>
  )
}

/** The file as the browser shows it: an image, a playable clip or track, or a link to a document. */
function Preview(props: { asset: Asset }) {
  const { asset } = props
  const frame = 'aspect-video w-full rounded-lg border border-mist object-contain'
  if (asset.url === null) return <p className="text-xs text-ash">The file is missing from storage.</p>
  switch (asset.kind) {
    case 'image':
      return <img src={asset.url} alt="" className={`${frame} bg-paper-tint`} />
    case 'clip':
      return <video src={asset.url} controls muted preload="metadata" className={`${frame} bg-ink`} />
    case 'audio':
      return <audio src={asset.url} controls preload="none" className="w-full" />
    case 'document':
      return (
        <a
          href={asset.url}
          target="_blank"
          rel="noreferrer"
          className={`${frame} flex flex-col items-center justify-center gap-1 bg-paper-tint text-xs text-ash hover:text-ink`}
        >
          <FileTextIcon size={28} aria-hidden />
          Open the document
        </a>
      )
  }
}

/** A file's size as the operator reads it: kilobytes under a megabyte, else megabytes. */
function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${megabytes(bytes)} MB`
}

/** Rename an asset, or change its tags or its note; checked with the backend's own words before the request. */
function EditForm(props: { asset: Asset; onDone: () => void }) {
  const update = useMutation(api.private.assets.update)
  const [name, setName] = React.useState(props.asset.name)
  const [tags, setTags] = React.useState(props.asset.tags.join(', '))
  const [note, setNote] = React.useState(props.asset.note)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const edited = () => {
    if (state.status === 'error') setState({ status: 'idle' })
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (state.status === 'saving') return
    const [problem] = assetProblems({ name, tags: parseAssetTags(tags), note })
    if (problem !== undefined) {
      setState({ status: 'error', message: problem })
      return
    }
    setState({ status: 'saving' })
    try {
      await update({ assetId: props.asset._id, name, tags: parseAssetTags(tags), note })
      props.onDone()
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <Field label="Name the writer asks for">
        <Input
          name="name"
          value={name}
          autoFocus
          onChange={(event) => {
            setName(event.target.value)
            edited()
          }}
        />
      </Field>
      <Field label="Tags, comma separated">
        <Input
          name="tags"
          value={tags}
          onChange={(event) => {
            setTags(event.target.value)
            edited()
          }}
        />
      </Field>
      <Field label="Note" hint={`${note.trim().length} of ${ASSET_NOTE_MAX} characters`}>
        <Textarea
          name="note"
          value={note}
          onChange={(event) => {
            setNote(event.target.value)
            edited()
          }}
        />
      </Field>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={props.onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" busy={state.status === 'saving'}>
          Save
        </Button>
      </div>
    </form>
  )
}

/**
 * Edit, and Delete behind an inline confirm step, like Clear history: the
 * question opens under the buttons and focus moves to Cancel, the safe answer.
 * An asset a script that may still be recorded shows has no Delete, since the
 * backend keeps it; the card says why. A refusal shows under the answers.
 */
/**
 * A generated asset that missed: a new one from the same prompt joins the
 * library beside it. The line under the button is a polite live region that
 * stays mounted and says it is on its way, or why it was refused.
 */
function GenerateAgain(props: { assetId: Id<'assets'> }) {
  const regenerate = useMutation(api.private.media.regenerateAsset)
  const [state, setState] = React.useState<FormState | { status: 'queued' }>({ status: 'idle' })
  const again = async () => {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      await regenerate({ assetId: props.assetId })
      setState({ status: 'queued' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="sm" variant="outline" busy={state.status === 'saving'} onClick={() => void again()}>
        Generate again
      </Button>
      <div aria-live="polite" className="text-[11px] text-ash">
        {state.status === 'queued' && 'The producer is on it; the new one joins the library beside this one.'}
        {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      </div>
    </div>
  )
}

/**
 * A picture from a prompt (docs/plan.md, slice 15): a still or a short clip
 * the producer generates in the persona's look and saves here, tagged
 * generated. The prompt is checked with the backend's own rules as the
 * operator types; the day's budget sits beside the button, and what is being
 * made or failed shows under the form.
 */
function GenerateForm(props: { personaId: Id<'personas'>; media: MediaData; onClose: () => void }) {
  const generate = useMutation(api.private.media.generate)
  const generatePortrait = useMutation(api.private.media.generatePortrait)
  // A portrait is an image the look leads with: every avatar take is animated from it.
  const [kind, setKind] = React.useState<MediaKind | 'portrait'>('image')
  const [prompt, setPrompt] = React.useState('')
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const { media } = props
  const problem = prompt.trim() === '' ? null : generationPromptProblem(prompt, media.sponsorName)
  const spent = budgetProblem(kind === 'portrait' ? 'image' : kind, media.spent)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (state.status === 'saving' || problem !== null || prompt.trim() === '') return
    setState({ status: 'saving' })
    try {
      if (kind === 'portrait') await generatePortrait({ personaId: props.personaId, description: prompt })
      else await generate({ personaId: props.personaId, kind, prompt })
      setPrompt('')
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <section aria-label="Generate">
      <form onSubmit={(event) => void submit(event)} className="card grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
          <Field label="Kind">
            <select
              className="field"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value === 'clip' ? 'clip' : event.target.value === 'portrait' ? 'portrait' : 'image')
              }
            >
              {MEDIA_KINDS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate === 'clip' ? `Clip, ${CLIP_SECONDS} s` : MEDIA_KIND_LABELS[candidate]}
                </option>
              ))}
              {media.presenter && <option value="portrait">Portrait</option>}
            </select>
          </Field>
          <Field
            label={kind === 'portrait' ? 'What the presenter looks like' : 'What it shows'}
            hint={kind === 'portrait' ? 'The portrait leads the look: every avatar take from now on is animated from it.' : undefined}
          >
            <Textarea
              rows={2}
              value={prompt}
              placeholder="A run history where every execution fails in red"
              onChange={(event) => {
                setPrompt(event.target.value)
                if (state.status === 'error') setState({ status: 'idle' })
              }}
            />
          </Field>
        </div>
        <div aria-live="polite">
          {problem !== null && <ErrorLine>{problem}</ErrorLine>}
          {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            busy={state.status === 'saving'}
            disabled={problem !== null || prompt.trim() === '' || spent !== null}
          >
            Generate
          </Button>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <span className="tabular text-xs text-ash">
            Today: {media.spent.images} of {media.budget.images} images, {media.spent.clipSeconds} of {media.budget.clipSeconds} s of clips.
            {spent === null ? ' Never a real person, another brand or a real screen.' : ` ${spent}`}
          </span>
        </div>
      </form>
    </section>
  )
}

/** What the producer is making for this page, or could not make in the last day; shown with the form open or closed. */
function Generations(props: { generations: MediaData['generations'] }) {
  // Stays mounted while empty, so the first generation appearing is announced.
  return (
    <ul aria-live="polite" className={props.generations.length === 0 ? 'hidden' : 'space-y-1 text-xs'}>
      {props.generations.map((generation) => (
        <li key={generation._id} className={generation.status === 'failed' ? 'text-signal-red-deep' : 'text-ash'}>
          {generation.status === 'failed' ? 'Could not make' : 'Generating'} {MEDIA_KIND_LABELS[generation.kind].toLowerCase()}:{' '}
          <q>{generation.prompt}</q>
          {generation.error && ` · ${generation.error}`}
        </li>
      ))}
    </ul>
  )
}

function CardActions(props: { asset: Asset; focusEdit: boolean; onEdit: () => void; onDeleted: (message: string) => void }) {
  const remove = useMutation(api.private.assets.remove)
  const [confirming, setConfirming] = React.useState(false)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const confirmId = React.useId()
  const asset = props.asset
  const cancel = () => {
    setConfirming(false)
    setState({ status: 'idle' })
    triggerRef.current?.focus()
  }
  const confirm = async () => {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      await remove({ assetId: asset._id })
      // The card goes with the asset, so focus moves to its section's status line.
      props.onDeleted(
        asset.keptByEpisode ? `Took "${asset.name}" out of the library; its episode keeps the render.` : `Deleted "${asset.name}".`
      )
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <div className="mt-auto flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" autoFocus={props.focusEdit} onClick={props.onEdit}>
          Edit
        </Button>
        {asset.shownIn.length === 0 && (
          <Button
            ref={triggerRef}
            size="sm"
            variant="destructive"
            aria-expanded={confirming}
            aria-controls={confirming ? confirmId : undefined}
            onClick={() => setConfirming((open) => !open)}
          >
            Delete
          </Button>
        )}
      </div>
      {confirming && (
        <div id={confirmId} className="flex flex-col items-end gap-2 text-right">
          <p className="text-xs">
            {asset.keptByEpisode
              ? `Take "${asset.name}" out of the library? Its episode keeps the render.`
              : `Delete "${asset.name}" and its file? This cannot be undone.`}
          </p>
          <div className="flex gap-2">
            {/* Focus lands on the safe answer, so an Enter pressed out of habit deletes nothing. */}
            <Button size="sm" variant="ghost" autoFocus onClick={cancel}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" busy={state.status === 'saving'} onClick={() => void confirm()}>
              Delete
            </Button>
          </div>
          {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
        </div>
      )}
    </div>
  )
}
