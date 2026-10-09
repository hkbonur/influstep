import { api } from '@influstep/convex/_generated/api'
import type { Doc, Id } from '@influstep/convex/_generated/dataModel'
import { PLATFORMS, PLATFORM_LABELS, type Platform } from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { PersonaChat } from '@/components/persona-chat'
import { PlatformGlyphs, SponsorPill, StatusPill } from '@/components/status'
import { Button, ErrorLine, Eyebrow, Field, Input, LinkButton, MockNote, Mono, PageHeader, Pill, Skeleton, Textarea } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatDateTime, formatDay, relativeTime } from '@/lib/format'

export const Route = createFileRoute('/personas/$personaId')({ component: PersonaPage })

function PersonaPage() {
  const params = Route.useParams()
  const personaId = params.personaId as Id<'personas'>
  const data = useQuery(api.private.personas.get, { personaId })
  const setPaused = useMutation(api.private.personas.setPaused)
  const planWeek = useMutation(api.private.personas.planWeek)
  const pollSignals = useMutation(api.private.personas.pollSignals)
  const pullMetrics = useMutation(api.private.personas.pullMetrics)
  const [settings, setSettings] = React.useState(false)

  if (data === undefined) return <Skeleton className="h-96" />
  if (data === null) return <p className="text-ash">This persona does not exist.</p>
  const { persona } = data
  const providersMock =
    data.jobs.some((job) => job.kind === 'pull_metrics') && data.episodes.some((episode) => episode.renders.some((render) => render.mock))

  return (
    <>
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
            <LinkButton to="/reports/$personaId" params={{ personaId }}>
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
      {settings && <SettingsForm persona={persona} onDone={() => setSettings(false)} />}

      <div className="grid gap-8 xl:grid-cols-[1fr_1.4fr_0.8fr] xl:gap-6">
        <div className="flex max-h-[70vh] min-h-[28rem] flex-col">
          <Eyebrow className="mb-3">Chat</Eyebrow>
          <PersonaChat persona={persona} messages={data.messages} directives={data.directives} />
        </div>

        <div>
          <Eyebrow className="mb-3">Episodes</Eyebrow>
          {data.episodes.length === 0 && <p className="text-ash">No episodes yet. Plan the week to get five.</p>}
          <ol className="divide-y divide-mist border-y border-mist">
            {data.episodes.map((episode) => (
              <li key={episode._id} className={cn('flex items-start gap-3 py-2.5', { 'opacity-60': episode.status === 'killed' })}>
                <span className="tabular w-16 shrink-0 pt-0.5 font-mono text-xs text-ash">
                  {formatDay(episode.plannedFor, { month: 'short', day: 'numeric' })}
                </span>
                <div className="min-w-0 flex-1">
                  <Link to="/episodes/$episodeId" params={{ episodeId: episode._id }} className="line-clamp-1 font-medium hover:underline">
                    {episode.title}
                  </Link>
                  <p className="line-clamp-1 text-xs text-ash">{episode.hook || episode.concept}</p>
                  {episode.error && <p className="mt-0.5 line-clamp-1 font-mono text-[11px] text-signal-red-deep">{episode.error}</p>}
                  {(episode.sponsorSegment !== 'none' || episode.variantKey) && (
                    <div className="mt-1 flex gap-1">
                      <SponsorPill segment={episode.sponsorSegment} />
                      {episode.variantKey && <Pill tint="fog">{episode.variantKey}</Pill>}
                    </div>
                  )}
                </div>
                <StatusPill status={episode.status} />
              </li>
            ))}
          </ol>
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
              <dt className="text-ash">Platforms</dt>
              <dd>
                <PlatformGlyphs platforms={persona.platforms} />
              </dd>
              <dt className="text-ash">Cadence</dt>
              <dd className="tabular">
                {persona.episodesPerWeek} a week at {String(persona.publishHour).padStart(2, '0')}:00 {persona.timezone}
              </dd>
              <dt className="text-ash">Sponsor dial</dt>
              <dd className="tabular">
                {Math.round(persona.sponsorDial * 100)}% after {persona.sponsorRampEpisodes} episodes
              </dd>
              <dt className="text-ash">Pillars</dt>
              <dd>{persona.pillars.join(', ')}</dd>
              <dt className="text-ash">Approval</dt>
              <dd>{persona.autoApprove ? 'Automatic' : 'You approve each script'}</dd>
              {data.bioLink && (
                <>
                  <dt className="text-ash">Link in bio</dt>
                  <dd>
                    <Mono>
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
                  <span
                    aria-hidden
                    className={cn('size-1.5 shrink-0 rounded-full', {
                      'bg-field-green': job.status === 'done',
                      'bg-signal-red': job.status === 'failed',
                      'bg-note-blue': job.status === 'running',
                      'bg-fog': job.status === 'queued',
                    })}
                  />
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

function ChecklistRow(props: {
  item: { _id: Id<'checklistItems'>; title: string; why: string; action?: { kind: string; url?: string; key?: string }; createdAt: number }
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
      setError(caught instanceof Error ? caught.message : String(caught))
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
            <LinkButton to="/providers" className="h-7 px-2.5 text-xs">
              Set {props.item.action.key}
            </LinkButton>
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
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [platforms, setPlatforms] = React.useState<Platform[]>(props.persona.platforms)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    setBusy(true)
    setError(null)
    try {
      await update({
        personaId: props.persona._id,
        name: text('name'),
        handle: props.persona.handle,
        niche: text('niche'),
        tone: text('tone'),
        bio: text('bio'),
        bible: text('bible'),
        pillars: text('pillars')
          .split(',')
          .map((pillar) => pillar.trim())
          .filter(Boolean),
        platforms,
        voiceId: text('voiceId'),
        sponsorDial: Number(form.get('sponsorDial')),
        sponsorRampEpisodes: Number(form.get('sponsorRampEpisodes')),
        episodesPerWeek: Number(form.get('episodesPerWeek')),
        autoApprove: form.get('autoApprove') === 'on',
        timezone: text('timezone'),
        publishHour: Number(form.get('publishHour')),
      })
      props.onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }
  const p = props.persona
  return (
    <form onSubmit={submit} className="card mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Name">
        <Input name="name" defaultValue={p.name} required />
      </Field>
      <Field label="Niche" className="lg:col-span-2">
        <Input name="niche" defaultValue={p.niche} required />
      </Field>
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
      <Field label="Publish hour" hint="Local hour, 0 to 23.">
        <Input name="publishHour" type="number" min={0} max={23} defaultValue={p.publishHour} />
      </Field>
      <Field label="Timezone">
        <Input name="timezone" defaultValue={p.timezone} required />
      </Field>
      <Field label="Voice id">
        <Input name="voiceId" defaultValue={p.voiceId} />
      </Field>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-medium text-graphite">Platforms</legend>
        <div className="flex gap-3">
          {PLATFORMS.map((platform) => (
            <label key={platform} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={platforms.includes(platform)}
                onChange={(event) =>
                  setPlatforms((current) => (event.target.checked ? [...current, platform] : current.filter((item) => item !== platform)))
                }
              />
              {PLATFORM_LABELS[platform]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" name="autoApprove" defaultChecked={p.autoApprove} />
        Approve scripts automatically
      </label>
      {error && (
        <div className="sm:col-span-2 lg:col-span-3">
          <ErrorLine>{error}</ErrorLine>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
        <Button type="submit" variant="primary" busy={busy} disabled={platforms.length === 0}>
          Save
        </Button>
        <Button variant="ghost" onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
