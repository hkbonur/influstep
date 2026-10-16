import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import {
  ONBOARDING_PERSONAS_MAX,
  PILLARS_MAX,
  PILLARS_MIN,
  firstUnusedPersonaColor,
  parsePillars,
  proposalProblems,
  type PersonaColor,
  type PersonaProposal,
  type PlatformFormat,
} from '@influstep/shared'
import { createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import React from 'react'
import { z } from 'zod'
import { FormatFields, defaultFormat } from '@/components/format-fields'
import { PersonaAvatar, PersonaColorSwatches } from '@/components/persona-avatar'
import { Button, ErrorLine, Field, Input, LinkButton, PageHeader, Skeleton, Textarea } from '@/components/ui'
import { errorMessage } from '@/lib/errors'

// `count` skips the first question: the sidebar's + adds one persona through the same flow.
const searchSchema = z.object({ count: z.number().int().min(1).max(ONBOARDING_PERSONAS_MAX).optional().catch(undefined) })

export const Route = createFileRoute('/onboarding')({ component: OnboardingPage, validateSearch: searchSchema })

/** Where the flow stands: how many to build, one persona at a time, then the roster it built. */
type Step = { kind: 'count' } | { kind: 'persona'; index: number; total: number } | { kind: 'done'; created: Id<'personas'>[] }

/** The parts of one persona's step, in order. */
type Part = 'who' | 'profile' | 'publishing'

const PART_LABELS: Record<Part, string> = { who: 'Who it talks to', profile: 'Who it is', publishing: 'Where it publishes' }

/** A new persona starts on YouTube and TikTok with the default format of each; the operator edits them. */
const FIRST_PLATFORMS = ['youtube', 'tiktok'] as const

function OnboardingPage() {
  const search = Route.useSearch()
  const start = useQuery(api.private.onboarding.start, {})
  const [step, setStep] = React.useState<Step>(() =>
    search.count === undefined ? { kind: 'count' } : { kind: 'persona', index: 0, total: search.count }
  )
  const [created, setCreated] = React.useState<Id<'personas'>[]>([])
  if (start === undefined) return <Skeleton className="h-96" />
  const firstRun = start.roster.length === 0 && created.length === 0

  if (step.kind === 'count') {
    return <CountStep firstRun={firstRun} onCount={(total) => setStep({ kind: 'persona', index: 0, total })} />
  }
  if (step.kind === 'done') return <DoneStep created={step.created} roster={start.roster} />
  return (
    <PersonaStep
      // A new persona starts from an empty draft.
      key={step.index}
      index={step.index}
      total={step.total}
      sponsorName={start.sponsorName}
      roster={start.roster}
      onCreated={(personaId) => {
        const next = [...created, personaId]
        setCreated(next)
        setStep(
          step.index + 1 < step.total ? { kind: 'persona', index: step.index + 1, total: step.total } : { kind: 'done', created: next }
        )
      }}
    />
  )
}

/** The heading of a step takes focus when the step appears, so a keyboard or screen reader user starts at its top. */
function StepHeading(props: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => ref.current?.focus(), [])
  return (
    <h2 ref={ref} tabIndex={-1} className="text-base font-semibold outline-none">
      {props.children}
    </h2>
  )
}

function CountStep(props: { firstRun: boolean; onCount: (total: number) => void }) {
  const [count, setCount] = React.useState(1)
  return (
    <div className="max-w-2xl">
      <PageHeader
        title={props.firstRun ? 'Build your roster' : 'Add personas'}
        lead="Each persona is an AI creator with its own niche, voice and look. Its agents research, write, record and publish for it, and it brings Formstep customers through what it makes."
      />
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          props.onCount(count)
        }}
      >
        <StepHeading>How many personas do you want to start with?</StepHeading>
        <p className="text-ash">You set each one up in turn, and can add more one at a time later.</p>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Personas</legend>
          {Array.from({ length: ONBOARDING_PERSONAS_MAX }, (_, offset) => offset + 1).map((value) => (
            <label
              key={value}
              className="flex h-9 min-w-12 cursor-pointer items-center justify-center rounded-lg border border-mist px-3 tabular has-[:checked]:border-ink has-[:checked]:bg-paper-warm has-[:focus-visible]:outline-2"
            >
              <input
                type="radio"
                name="count"
                value={value}
                checked={count === value}
                onChange={() => setCount(value)}
                className="sr-only"
              />
              {value}
            </label>
          ))}
        </fieldset>
        <Button type="submit" variant="primary">
          Continue
        </Button>
      </form>
    </div>
  )
}

/** A persona as the operator builds it: the niche and audience, then the proposal they edit, then where it publishes. */
interface Draft {
  niche: string
  audience: string
  name: string
  handle: string
  color: PersonaColor
  tone: string
  pillars: string
  bio: string
  bible: string
  formats: PlatformFormat[]
  episodesPerWeek: number
  sponsorDial: number
  voiceId: string
}

function PersonaStep(props: {
  index: number
  total: number
  sponsorName: string
  roster: { _id: Id<'personas'>; name: string; handle: string; color: PersonaColor }[]
  onCreated: (personaId: Id<'personas'>) => void
}) {
  const propose = useAction(api.private.onboarding.propose)
  const create = useMutation(api.private.onboarding.create)
  const [part, setPart] = React.useState<Part>('who')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Draft>(() => ({
    niche: '',
    audience: '',
    name: '',
    handle: '',
    color: firstUnusedPersonaColor(props.roster.map((persona) => persona.color)),
    tone: '',
    pillars: '',
    bio: '',
    bible: '',
    formats: FIRST_PLATFORMS.map(defaultFormat),
    episodesPerWeek: 3,
    sponsorDial: 0.3,
    voiceId: '',
  }))
  const patch = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }))
  const takenHandles = props.roster.map((persona) => persona.handle)
  const proposal = (): PersonaProposal & { niche: string; audience: string } => ({
    niche: draft.niche,
    audience: draft.audience,
    name: draft.name.trim(),
    handle: draft.handle.trim().replace(/^@/, ''),
    tone: draft.tone,
    pillars: parsePillars(draft.pillars),
    bio: draft.bio,
    bible: draft.bible,
  })
  const problems = proposalProblems(proposal(), takenHandles)

  const askForProposal = async () => {
    setBusy(true)
    setError(null)
    try {
      const proposed = await propose({ niche: draft.niche, audience: draft.audience })
      patch({ ...proposed, pillars: proposed.pillars.join(', ') })
      setPart('profile')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const createPersona = async () => {
    setBusy(true)
    setError(null)
    try {
      const personaId = await create({
        appUrl: window.location.origin,
        ...proposal(),
        color: draft.color,
        formats: draft.formats,
        episodesPerWeek: draft.episodesPerWeek,
        sponsorDial: draft.sponsorDial,
        voiceId: draft.voiceId.trim(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      props.onCreated(personaId)
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  const parts: Part[] = ['who', 'profile', 'publishing']
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={props.total === 1 ? 'New persona' : `Persona ${props.index + 1} of ${props.total}`}
        lead={
          <ol className="flex flex-wrap gap-x-4 gap-y-1">
            {parts.map((candidate, position) => (
              <li
                key={candidate}
                aria-current={candidate === part ? 'step' : undefined}
                className={candidate === part ? 'text-ink' : undefined}
              >
                <span className="tabular">{position + 1}.</span> {PART_LABELS[candidate]}
              </li>
            ))}
          </ol>
        }
      />

      {part === 'who' && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void askForProposal()
          }}
        >
          <StepHeading>What is it about, and who is it for?</StepHeading>
          <p className="text-ash">The writer proposes a name, a handle, a tone, pillars and a bible from these. You edit all of it next.</p>
          <Field label="Niche" hint="What the persona makes videos about.">
            <Input
              value={draft.niche}
              onChange={(event) => patch({ niche: event.target.value })}
              placeholder="Notion setups for freelancers"
              required
            />
          </Field>
          <Field label="Audience" hint="Who watches, in a few words.">
            <Input
              value={draft.audience}
              onChange={(event) => patch({ audience: event.target.value })}
              placeholder="freelance designers who juggle five clients"
              required
            />
          </Field>
          <StepError message={error} />
          <Button type="submit" variant="primary" busy={busy}>
            Propose a persona
          </Button>
        </form>
      )}

      {part === 'profile' && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (problems.length === 0) setPart('publishing')
          }}
        >
          <StepHeading>Who it is</StepHeading>
          <p className="text-ash">
            The writer's proposal for {draft.audience.trim()}. Change anything; every script and post reads the tone, the pillars and the
            bible.
          </p>
          <div className="flex items-center gap-3">
            <PersonaAvatar color={draft.color} state="idle" size={48} />
            <PersonaColorSwatches
              value={draft.color}
              onChange={(color) => patch({ color })}
              taken={props.roster.map((persona) => persona.color)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
            </Field>
            <Field label="Handle" hint="The same on every platform; it is also the utm_source.">
              <Input value={draft.handle} onChange={(event) => patch({ handle: event.target.value })} />
            </Field>
            <Field label="Tone">
              <Input value={draft.tone} onChange={(event) => patch({ tone: event.target.value })} />
            </Field>
            <Field label="Content pillars" hint={`${PILLARS_MIN} to ${PILLARS_MAX}, comma separated.`}>
              <Input value={draft.pillars} onChange={(event) => patch({ pillars: event.target.value })} />
            </Field>
            <Field label="Bio" className="sm:col-span-2">
              <Input value={draft.bio} onChange={(event) => patch({ bio: event.target.value })} />
            </Field>
            <Field label="Persona bible" hint="How it speaks, what it shows, what it never says." className="sm:col-span-2">
              <Textarea value={draft.bible} onChange={(event) => patch({ bible: event.target.value })} rows={4} />
            </Field>
          </div>
          <Problems problems={problems} />
          <StepError message={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={problems.length > 0}>
              Next
            </Button>
            <Button variant="outline" busy={busy} onClick={() => void askForProposal()}>
              Propose again
            </Button>
            <Button variant="ghost" onClick={() => setPart('who')}>
              Back
            </Button>
          </div>
        </form>
      )}

      {part === 'publishing' && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void createPersona()
          }}
        >
          <StepHeading>Where {draft.name.trim()} publishes</StepHeading>
          <p className="text-ash">
            The platforms and the format on each, how often it publishes and how often {props.sponsorName} comes up. Creating it plans the
            rest of this week and next week; you approve each script.
          </p>
          <FormatFields value={draft.formats} onChange={(formats) => patch({ formats })} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Videos a week">
              <Input
                type="number"
                min={1}
                max={7}
                value={draft.episodesPerWeek}
                onChange={(event) => patch({ episodesPerWeek: Number(event.target.value) })}
              />
            </Field>
            <Field label="Sponsor dial" hint={`Share of videos that carry ${props.sponsorName}, after the first ten.`}>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={draft.sponsorDial}
                onChange={(event) => patch({ sponsorDial: Number(event.target.value) })}
              />
            </Field>
            <Field label="Voice id" hint="The ElevenLabs voice it speaks with.">
              <Input value={draft.voiceId} onChange={(event) => patch({ voiceId: event.target.value })} placeholder="mock-voice" required />
            </Field>
          </div>
          <StepError message={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={busy}>
              Create and plan the week
            </Button>
            <Button variant="ghost" onClick={() => setPart('profile')}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

/** The proposal's problems as the operator types, in a polite live list; Next stays off while there are any. */
function Problems(props: { problems: string[] }) {
  return (
    <ul aria-live="polite" className="space-y-1 text-xs text-signal-red-deep">
      {props.problems.map((problem) => (
        <li key={problem}>{problem}</li>
      ))}
    </ul>
  )
}

/** A refusal from the backend, in a polite live region that stays mounted. */
function StepError(props: { message: string | null }) {
  return <div aria-live="polite">{props.message && <ErrorLine>{props.message}</ErrorLine>}</div>
}

function DoneStep(props: {
  created: Id<'personas'>[]
  roster: { _id: Id<'personas'>; name: string; handle: string; color: PersonaColor }[]
}) {
  const built = props.roster.filter((persona) => props.created.includes(persona._id))
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title={built.length === 1 ? 'Persona created' : 'Roster ready'} />
      <StepHeading>
        {built.length === 1
          ? `${built[0]?.name ?? 'Your persona'} is planning its first weeks.`
          : 'Your personas are planning their first weeks.'}
      </StepHeading>
      <p className="text-ash">
        The writer plans the rest of this week and next week, and writes each script the day before it goes out. Each one waits for your
        approval on the calendar.
      </p>
      <ul className="divide-y divide-mist border-y border-mist">
        {built.map((persona) => (
          <li key={persona._id} className="flex items-center gap-3 py-2">
            <PersonaAvatar color={persona.color} state="idle" size={32} />
            <span className="font-medium">{persona.name}</span>
            <span className="font-mono text-xs text-ash">@{persona.handle}</span>
            <LinkButton to="/personas/$personaId" params={{ personaId: persona._id }} variant="ghost" className="ml-auto">
              Open
            </LinkButton>
          </li>
        ))}
      </ul>
      <LinkButton to="/" variant="primary">
        Open the calendar
      </LinkButton>
    </div>
  )
}
