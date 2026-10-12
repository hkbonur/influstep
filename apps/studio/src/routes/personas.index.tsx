import { firstUnusedPersonaColor, type PersonaColor, type Platform, type PlatformFormat } from '@influstep/shared'
import { api } from '@influstep/convex/_generated/api'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { z } from 'zod'
import { FormatFields, defaultFormat } from '@/components/format-fields'
import { PersonaAvatar, PersonaColorSwatches, personaAvatarState } from '@/components/persona-avatar'
import { PlatformGlyphs } from '@/components/status'
import {
  Button,
  Empty,
  ErrorLine,
  Field,
  type FormState,
  Input,
  LinkButton,
  Mono,
  PageHeader,
  Pill,
  Skeleton,
  Textarea,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'

/** `new` opens the new persona form, so the sidebar's + lands on it open. */
const searchSchema = z.object({ new: z.boolean().optional() })

export const Route = createFileRoute('/personas/')({ component: PersonasPage, validateSearch: searchSchema })

function PersonasPage() {
  const personas = useQuery(api.private.personas.list, {})
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  // The address is the one source: the + in the sidebar and the button here both open the form through it.
  const creating = search.new === true
  const setCreating = (open: boolean) => navigate({ search: { new: open ? true : undefined } })
  return (
    <>
      <PageHeader
        title="Personas"
        lead="Each persona is a profile its five agents work for. Compare them in Reports."
        actions={
          <Button variant="primary" onClick={() => setCreating(!creating)}>
            {creating ? 'Close' : 'New persona'}
          </Button>
        }
      />
      {/* The form waits for the roster: its default color is the first one no persona wears. */}
      {creating && personas && <NewPersonaForm usedColors={personas.map((persona) => persona.color)} onDone={() => setCreating(false)} />}
      {!personas && <Skeleton className="h-40" />}
      {personas && personas.length === 0 && (
        <Empty action={<Button onClick={() => setCreating(true)}>New persona</Button>}>No personas yet. Run the seed, or create one.</Empty>
      )}
      {personas && personas.length > 0 && (
        <div className="divide-y divide-mist border-y border-mist">
          {personas.map((persona) => (
            <div key={persona._id} className="grid items-center gap-x-6 gap-y-2 py-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="flex min-w-0 items-start gap-3">
                <PersonaAvatar
                  color={persona.color}
                  state={personaAvatarState(persona)}
                  size={32}
                  className={cn({ 'text-fog': persona.paused })}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/personas/$personaId" params={{ personaId: persona._id }} className="font-medium hover:underline">
                      {persona.name}
                    </Link>
                    {/* The avatar shows the thinking dots but is hidden from screen readers; this says it in words. */}
                    {personaAvatarState(persona) === 'thinking' && <span className="sr-only">working</span>}
                    <Mono className="text-ash">@{persona.handle}</Mono>
                    {persona.paused && <Pill tint="alert-amber">Paused</Pill>}
                    {persona.autoApprove && <Pill tint="fog">Auto-approves</Pill>}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-ash">{persona.niche}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ash">
                    <PlatformGlyphs platforms={persona.formats.map((format) => format.platform)} />
                    <span className="tabular">{persona.episodesPerWeek} a week</span>
                    <span className="tabular">sponsor {Math.round(persona.sponsorDial * 100)}%</span>
                    <span>{persona.pillars.join(' · ')}</span>
                  </div>
                </div>
              </div>
              <dl className="flex gap-5 text-xs">
                <Count label="Published" value={persona.counts.published} />
                <Count label="Approve" value={persona.counts.needsApproval} tone={persona.counts.needsApproval > 0 ? 'blue' : undefined} />
                <Count label="Failed" value={persona.counts.failed} tone={persona.counts.failed > 0 ? 'red' : undefined} />
                <Count label="Checklist" value={persona.counts.checklist} tone={persona.counts.checklist > 0 ? 'amber' : undefined} />
              </dl>
              <div className="flex gap-2">
                <LinkButton to="/reports/$personaId" params={{ personaId: persona._id }}>
                  Report
                </LinkButton>
                <LinkButton to="/personas/$personaId" params={{ personaId: persona._id }} variant="ghost">
                  Open
                </LinkButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Count(props: { label: string; value: number; tone?: 'blue' | 'red' | 'amber' }) {
  return (
    <div className="min-w-14">
      <dt className="text-ash">{props.label}</dt>
      <dd
        className={cn('tabular text-base font-medium', {
          'text-note-blue-deep': props.tone === 'blue',
          'text-signal-red-deep': props.tone === 'red',
          'text-alert-amber-deep': props.tone === 'amber',
        })}
      >
        {props.value}
      </dd>
    </div>
  )
}

/** A new persona starts on YouTube and TikTok with the default format of each; the operator edits them before creating it. */
const NEW_PERSONA_PLATFORMS: Platform[] = ['youtube', 'tiktok']

/** How many episodes a new persona publishes unsponsored before the dial applies (CONTEXT.md, "Sponsor dial"). */
const SPONSOR_RAMP_EPISODES = 10

function NewPersonaForm(props: { usedColors: PersonaColor[]; onDone: () => void }) {
  const create = useMutation(api.private.personas.create)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const [color, setColor] = React.useState<PersonaColor>(() => firstUnusedPersonaColor(props.usedColors))
  const [formats, setFormats] = React.useState<PlatformFormat[]>(() => NEW_PERSONA_PLATFORMS.map(defaultFormat))
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    setState({ status: 'saving' })
    try {
      await create({
        name: text('name'),
        color,
        handle: text('handle').replace(/^@/, ''),
        niche: text('niche'),
        tone: text('tone'),
        bio: text('bio'),
        bible: text('bible'),
        pillars: text('pillars')
          .split(',')
          .map((pillar) => pillar.trim())
          .filter(Boolean),
        formats,
        voiceId: text('voiceId') || 'mock-voice',
        sponsorDial: Number(form.get('sponsorDial') ?? 0.3),
        sponsorRampEpisodes: SPONSOR_RAMP_EPISODES,
        episodesPerWeek: Number(form.get('episodesPerWeek') ?? 3),
        autoApprove: false,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      props.onDone()
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <form onSubmit={submit} className="card mb-6 grid gap-4 sm:grid-cols-2">
      <Field label="Name">
        <Input name="name" required placeholder="Ada Automates" />
      </Field>
      <Field label="Handle" hint="The same on every platform; it is also the utm_source.">
        <Input name="handle" required placeholder="ada.automates" pattern="@?[a-z0-9._-]+" />
      </Field>
      <div className="sm:col-span-2">
        <PersonaColorSwatches value={color} onChange={setColor} taken={props.usedColors} />
      </div>
      <Field label="Niche" className="sm:col-span-2">
        <Input name="niche" required placeholder="n8n and workflow automation for small teams" />
      </Field>
      <Field label="Tone">
        <Input name="tone" required placeholder="calm, precise, a little dry" />
      </Field>
      <Field label="Content pillars" hint="Three to five, comma separated.">
        <Input name="pillars" required placeholder="n8n tutorials, AI agent workflows, Automation fails" />
      </Field>
      <Field label="Bio" className="sm:col-span-2">
        <Input name="bio" required placeholder="One n8n fix a day." />
      </Field>
      <Field label="Persona bible" hint="How it speaks, what it never says. Every writer run reads this." className="sm:col-span-2">
        <Textarea name="bible" required />
      </Field>
      <Field label="Episodes a week">
        <Input name="episodesPerWeek" type="number" min={1} max={7} defaultValue={3} />
      </Field>
      <Field label="Sponsor dial" hint={`Share of episodes that carry the sponsor, after the first ${SPONSOR_RAMP_EPISODES}.`}>
        <Input name="sponsorDial" type="number" min={0} max={1} step={0.1} defaultValue={0.3} />
      </Field>
      <Field label="Voice id" hint="ElevenLabs voice id in real mode.">
        <Input name="voiceId" placeholder="mock-voice" />
      </Field>
      <FormatFields value={formats} onChange={setFormats} className="sm:col-span-2" />
      {state.status === 'error' && (
        <div className="sm:col-span-2">
          <ErrorLine>{state.message}</ErrorLine>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" busy={state.status === 'saving'}>
          Create persona
        </Button>
        <Button variant="ghost" onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
