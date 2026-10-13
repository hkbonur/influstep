import { api } from '@influstep/convex/_generated/api'
import type { Doc, Id } from '@influstep/convex/_generated/dataModel'
import {
  DELIVERY_LABELS,
  EPISODE_KIND_LABELS,
  formatLength,
  isPost,
  type PersonaColor,
  type PlatformFormat,
  type Voice,
} from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { FormatFields } from '@/components/format-fields'
import { PersonaColorSwatches, PersonaMascot, personaAvatarState } from '@/components/persona-avatar'
import { PersonaChat } from '@/components/persona-chat'
import { JobDot, PlatformGlyphs, PostKindIcon, SponsorPill, StatusPill } from '@/components/status'
import {
  Button,
  CheckboxField,
  ErrorLine,
  Eyebrow,
  ExternalLinkButton,
  Field,
  type FormState,
  Input,
  LinkButton,
  MockNote,
  Mono,
  PageHeader,
  Pill,
  Skeleton,
  Textarea,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, formatDay, formatHour, languageName, relativeTime } from '@/lib/format'

export const Route = createFileRoute('/personas/$personaId')({ component: PersonaPage })

function PersonaPage() {
  const params = Route.useParams()
  const personaId = params.personaId as Id<'personas'>
  const data = useQuery(api.private.personas.get, { personaId })
  const setPaused = useMutation(api.private.personas.setPaused)
  const planWeek = useMutation(api.private.personas.planWeek)
  const pollSignals = useMutation(api.private.personas.pollSignals)
  const pullMetrics = useMutation(api.private.personas.pullMetrics)
  const retireDiscountCode = useMutation(api.private.personas.retireDiscountCode)
  const [settings, setSettings] = React.useState(false)

  if (data === undefined) return <Skeleton className="h-96" />
  if (data === null) return <p className="text-ash">This persona does not exist.</p>
  const { persona } = data
  const providersMock =
    data.jobs.some((job) => job.kind === 'pull_metrics') && data.episodes.some((episode) => episode.renders.some((render) => render.mock))

  return (
    <>
      <div className="flex items-start gap-4">
        <PersonaMascot
          color={persona.color}
          state={personaAvatarState({ working: data.working, paused: persona.paused })}
          size={48}
          // Fog, as in the sidebar: a paused persona reads as switched off on every screen.
          className={cn({ 'text-fog': persona.paused })}
        />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={persona.name}
            lead={
              <>
                <Mono>@{persona.handle}</Mono> · {persona.niche}
                {persona.paused && (
                  <>
                    {' '}
                    <Pill tint="alert-amber">Paused</Pill>
                  </>
                )}
              </>
            }
            actions={
              <>
                <Button size="sm" onClick={() => pollSignals({ personaId })}>
                  Poll signals
                </Button>
                <Button size="sm" onClick={() => planWeek({ personaId })}>
                  Plan this week
                </Button>
                <Button size="sm" onClick={() => pullMetrics({ personaId })}>
                  Pull metrics
                </Button>
                <LinkButton to="/reports/$personaId" params={{ personaId }} size="sm">
                  Report
                </LinkButton>
                <Button size="sm" variant="ghost" onClick={() => setSettings((value) => !value)}>
                  {settings ? 'Close settings' : 'Settings'}
                </Button>
                <Button
                  size="sm"
                  variant={persona.paused ? 'primary' : 'destructive'}
                  onClick={() => setPaused({ personaId, paused: !persona.paused })}
                >
                  {persona.paused ? 'Resume' : 'Pause'}
                </Button>
              </>
            }
          />
        </div>
      </div>
      {settings && <SettingsForm persona={persona} onDone={() => setSettings(false)} />}

      <div className="grid gap-8 xl:grid-cols-[1fr_1.4fr_0.8fr] xl:gap-6">
        <div className="flex max-h-[70vh] min-h-[28rem] flex-col">
          <Eyebrow className="mb-3">Chat</Eyebrow>
          <PersonaChat persona={persona} messages={data.messages} directives={data.directives} episodes={data.episodes} jobs={data.jobs} />
        </div>

        <div>
          <Eyebrow className="mb-3">Episodes</Eyebrow>
          {data.episodes.length === 0 && <p className="text-ash">No episodes yet. Plan the week to get {persona.episodesPerWeek}.</p>}
          {data.episodes.length > 0 && (
            <ol className="divide-y divide-mist border-y border-mist">
              {data.episodes.map((episode) => (
                <li key={episode._id} className={cn('flex items-start gap-3 py-2.5', { 'opacity-60': episode.status === 'killed' })}>
                  <span className="tabular w-16 shrink-0 pt-0.5 font-mono text-xs text-ash">
                    {formatDay(episode.plannedFor, { month: 'short', day: 'numeric' })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/episodes/$episodeId"
                      params={{ episodeId: episode._id }}
                      className="flex items-center gap-1.5 font-medium hover:underline"
                    >
                      {isPost(episode.kind) && <PostKindIcon kind={episode.kind} className="shrink-0 text-graphite" />}
                      <span className="line-clamp-1">{episode.title}</span>
                    </Link>
                    <p className="line-clamp-1 text-xs text-ash">{episode.hook || episode.concept}</p>
                    {episode.error && <p className="mt-0.5 line-clamp-1 font-mono text-[11px] text-signal-red-deep">{episode.error}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <PlatformGlyphs platforms={episode.platforms} />
                      <SponsorPill segment={episode.sponsorSegment} />
                      {episode.variantKey && <Pill tint="fog">{episode.variantKey}</Pill>}
                    </div>
                  </div>
                  <StatusPill status={episode.status} />
                </li>
              ))}
            </ol>
          )}
          <MockNote when={providersMock} />
        </div>

        <div className="space-y-8">
          <section>
            <Eyebrow className="mb-3">Checklist</Eyebrow>
            {data.checklist.length === 0 && <p className="text-ash">Nothing waits on you.</p>}
            <ul className="space-y-3">
              {data.checklist.map((item) => (
                <ChecklistRow
                  key={item._id}
                  item={item}
                  episodeTitle={data.episodes.find((episode) => episode._id === item.episodeId)?.title ?? null}
                />
              ))}
            </ul>
          </section>

          <section>
            <Eyebrow className="mb-3">Profile</Eyebrow>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-ash">Cadence</dt>
              <dd className="tabular">
                {persona.episodesPerWeek} a week, {persona.timezone}
              </dd>
              <dt className="text-ash">Formats</dt>
              {/* One grid for every format: glyph, length over delivery, hour, so the narrow column never breaks a row mid-phrase. */}
              <dd className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1.5">
                {persona.formats.map((format) => (
                  <React.Fragment key={format.platform}>
                    <PlatformGlyphs platforms={[format.platform]} />
                    <span>
                      <span className="tabular">{formatLength(format.lengthSec)}</span>
                      <span className="block text-ash">{DELIVERY_LABELS[format.delivery]}</span>
                    </span>
                    <Mono className="text-ash">{formatHour(format.publishHour)}</Mono>
                    {format.cadence && (
                      <span className="col-start-2 col-end-4 text-ash">
                        <span className="tabular">{format.cadence.postsPerDay}</span> {format.cadence.postsPerDay === 1 ? 'post' : 'posts'}{' '}
                        a day: {format.cadence.kinds.map((kind) => EPISODE_KIND_LABELS[kind].toLowerCase()).join(', ')}
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </dd>
              {persona.formats.some((format) => format.platform === 'x') && (
                <>
                  <dt className="text-ash">Voice</dt>
                  <dd>
                    <Link to="/personas/$personaId/voice" params={{ personaId }} className="hover:underline">
                      {persona.voice ? voiceSummary(persona.voice) : 'Not learned yet'}
                    </Link>
                  </dd>
                </>
              )}
              <dt className="text-ash">Sponsor dial</dt>
              <dd className="tabular">
                {Math.round(persona.sponsorDial * 100)}% after {persona.sponsorRampEpisodes} episodes
              </dd>
              <dt className="text-ash">Pillars</dt>
              <dd>{persona.pillars.join(', ')}</dd>
              <dt className="text-ash">Approval</dt>
              <dd>{persona.autoApprove ? 'Automatic' : 'You approve each script'}</dd>
              <dt className="text-ash">Publishing</dt>
              <dd>{persona.autoPublish ? 'Publishes on its own' : 'You approve each package'}</dd>
              <dt className="text-ash">Discount codes</dt>
              <dd className="space-y-1">
                {data.discountCodes.length === 0 && (
                  <span>
                    None yet.{' '}
                    <button type="button" className="text-ash hover:text-ink" onClick={() => setSettings(true)}>
                      Give a code
                    </button>
                  </span>
                )}
                {data.discountCodes.map((discountCode) => (
                  <div key={discountCode._id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <Mono>{discountCode.code}</Mono>
                    <span>{discountCode.offer}</span>
                    <span className="tabular text-ash">{discountCode.redemptions} redemptions</span>
                    {discountCode.episodeTitle && <span className="text-ash">for {discountCode.episodeTitle}</span>}
                    <button
                      type="button"
                      className="text-ash hover:text-ink"
                      onClick={() => retireDiscountCode({ discountCodeId: discountCode._id })}
                    >
                      Retire
                    </button>
                  </div>
                ))}
              </dd>
              {data.bioLink && (
                <>
                  <dt className="text-ash">Link in bio</dt>
                  <dd>
                    <Mono className="break-all">
                      {data.appUrl}/p/{persona.handle}
                    </Mono>{' '}
                    <span className="text-ash">
                      · {data.bioLink.clicks} clicks on /go/{data.bioLink.slug}
                    </span>
                  </dd>
                </>
              )}
            </dl>
          </section>

          <section>
            <Eyebrow className="mb-3">Recent jobs</Eyebrow>
            <ul className="space-y-1 font-mono text-[11px]">
              {data.jobs.map((job) => (
                <li key={job._id} className="flex items-center gap-2">
                  <JobDot status={job.status} />
                  <span className="text-graphite">{job.kind}</span>
                  <span className="text-ash">{job.role}</span>
                  <span className="ml-auto text-ash">{relativeTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  )
}

/** The voice row: how many posts the analyst read and the language it writes in. */
function voiceSummary(voice: Voice): string {
  const name = languageName(voice.language)
  // A tag the browser cannot name still says which language it is, so it shows as written.
  const language = name === null ? voice.language : name
  return `Learned from ${voice.sampleSize} posts, ${language}`
}

function ChecklistRow(props: {
  item: Pick<Doc<'checklistItems'>, '_id' | 'title' | 'why' | 'action' | 'createdAt'>
  episodeTitle: string | null
}) {
  const complete = useMutation(api.private.checklist.complete)
  const runAction = useMutation(api.private.checklist.runAction)
  const [error, setError] = React.useState<string | null>(null)
  const act = async () => {
    setError(null)
    try {
      await runAction({ itemId: props.item._id })
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }
  return (
    <li className="flex items-start gap-2.5">
      <input
        type="checkbox"
        className="mt-1 size-3.5 accent-ink"
        aria-label={`Done: ${props.item.title}`}
        onChange={() => complete({ itemId: props.item._id })}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{props.item.title}</p>
        <p className="text-xs text-ash">{props.item.why}</p>
        {props.episodeTitle && <p className="mt-0.5 font-mono text-[11px] text-ash">unblocks: {props.episodeTitle}</p>}
        <div className="mt-1.5 flex gap-2">
          {props.item.action?.kind === 'open_browser' && (
            <Button size="sm" onClick={act}>
              Open browser
            </Button>
          )}
          {props.item.action?.kind === 'set_provider_key' && (
            <LinkButton to="/providers" size="sm">
              Set {props.item.action.key}
            </LinkButton>
          )}
          {/* A page the operator reads and acts on by hand; the runner never opens it. */}
          {props.item.action?.kind === 'visit' && (
            <ExternalLinkButton href={props.item.action.url} size="sm">
              Open
            </ExternalLinkButton>
          )}
        </div>
        {error && <ErrorLine>{error}</ErrorLine>}
      </div>
      <span className="shrink-0 text-[11px] text-ash">{formatDateTime(props.item.createdAt)}</span>
    </li>
  )
}

function SettingsForm(props: { persona: Doc<'personas'>; onDone: () => void }) {
  const update = useMutation(api.private.personas.update)
  const giveDiscountCode = useMutation(api.private.personas.giveDiscountCode)
  const personas = useQuery(api.private.personas.list, {})
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const [color, setColor] = React.useState<PersonaColor>(props.persona.color)
  const [formats, setFormats] = React.useState<PlatformFormat[]>(props.persona.formats)
  const [code, setCode] = React.useState('')
  const [offer, setOffer] = React.useState('')
  const [codeState, setCodeState] = React.useState<FormState>({ status: 'idle' })
  const giveCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCodeState({ status: 'saving' })
    try {
      await giveDiscountCode({ personaId: props.persona._id, code: code.trim(), offer: offer.trim() })
      setCode('')
      setOffer('')
      setCodeState({ status: 'idle' })
    } catch (caught) {
      setCodeState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    setState({ status: 'saving' })
    try {
      await update({
        personaId: props.persona._id,
        name: text('name'),
        color,
        handle: props.persona.handle,
        niche: text('niche'),
        tone: text('tone'),
        bio: text('bio'),
        bible: text('bible'),
        pillars: text('pillars')
          .split(',')
          .map((pillar) => pillar.trim())
          .filter(Boolean),
        formats,
        voiceId: text('voiceId'),
        sponsorDial: Number(form.get('sponsorDial')),
        sponsorRampEpisodes: Number(form.get('sponsorRampEpisodes')),
        episodesPerWeek: Number(form.get('episodesPerWeek')),
        autoApprove: form.get('autoApprove') === 'on',
        autoPublish: form.get('autoPublish') === 'on',
        timezone: text('timezone'),
      })
      props.onDone()
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const p = props.persona
  // Unknown until the roster loads; the swatches then name the colors other personas wear.
  const takenColors = personas?.filter((persona) => persona._id !== p._id).map((persona) => persona.color)
  return (
    <div className="card mb-8 space-y-4">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name">
          <Input name="name" defaultValue={p.name} required />
        </Field>
        <Field label="Niche" className="lg:col-span-2">
          <Input name="niche" defaultValue={p.niche} required />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <PersonaColorSwatches value={color} onChange={setColor} taken={takenColors} />
        </div>
        <Field label="Tone">
          <Input name="tone" defaultValue={p.tone} required />
        </Field>
        <Field label="Content pillars" hint="Comma separated." className="lg:col-span-2">
          <Input name="pillars" defaultValue={p.pillars.join(', ')} required />
        </Field>
        <Field label="Bio" className="sm:col-span-2 lg:col-span-3">
          <Input name="bio" defaultValue={p.bio} required />
        </Field>
        <Field label="Persona bible" className="sm:col-span-2 lg:col-span-3">
          <Textarea name="bible" defaultValue={p.bible} required className="min-h-28" />
        </Field>
        <Field label="Episodes a week">
          <Input name="episodesPerWeek" type="number" min={1} max={7} defaultValue={p.episodesPerWeek} />
        </Field>
        <Field label="Sponsor dial" hint="0 to 1">
          <Input name="sponsorDial" type="number" min={0} max={1} step={0.05} defaultValue={p.sponsorDial} />
        </Field>
        <Field label="Unsponsored ramp" hint="Episodes before the dial applies.">
          <Input name="sponsorRampEpisodes" type="number" min={0} defaultValue={p.sponsorRampEpisodes} />
        </Field>
        <Field label="Timezone" hint="Publish hours are local to it.">
          <Input name="timezone" defaultValue={p.timezone} required />
        </Field>
        <Field label="Voice id">
          <Input name="voiceId" defaultValue={p.voiceId} />
        </Field>
        <CheckboxField label="Approval" name="autoApprove" defaultChecked={p.autoApprove}>
          Approve scripts automatically
        </CheckboxField>
        <CheckboxField
          label="Publishing"
          name="autoPublish"
          defaultChecked={p.autoPublish}
          hint="Off: each rendered episode waits for you as a publish package."
        >
          Publishes on its own
        </CheckboxField>
        <FormatFields value={formats} onChange={setFormats} className="sm:col-span-2 lg:col-span-3" />
        {state.status === 'error' && (
          <div className="sm:col-span-2 lg:col-span-3">
            <ErrorLine>{state.message}</ErrorLine>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
          <Button type="submit" variant="primary" busy={state.status === 'saving'}>
            Save
          </Button>
          <Button variant="ghost" onClick={props.onDone}>
            Cancel
          </Button>
        </div>
      </form>
      <form onSubmit={giveCode} className="grid gap-4 border-t border-mist pt-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <Eyebrow>Discount code</Eyebrow>
          <p className="mt-1 text-xs text-ash">
            Create the code in Polar first. Every video description that has not gone out yet carries it, publish packages included; X posts
            carry no code.
          </p>
        </div>
        <Field label="Code">
          <Input name="code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="ADA20" required />
        </Field>
        <Field label="Offer" className="lg:col-span-2">
          <Input
            name="offer"
            value={offer}
            onChange={(event) => setOffer(event.target.value)}
            placeholder="20% off Pro for 3 months"
            required
          />
        </Field>
        {codeState.status === 'error' && (
          <div className="sm:col-span-2 lg:col-span-3">
            <ErrorLine>{codeState.message}</ErrorLine>
          </div>
        )}
        <div className="sm:col-span-2 lg:col-span-3">
          <Button type="submit" busy={codeState.status === 'saving'}>
            Give code
          </Button>
        </div>
      </form>
    </div>
  )
}
