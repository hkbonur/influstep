import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import {
  EXPERIMENT_KINDS,
  EXPERIMENT_KIND_LABELS,
  METRIC_KEYS,
  METRIC_LABELS,
  confidencePercent,
  type ExperimentKind,
  type MetricKey,
  type StrategyDefault,
} from '@influstep/shared'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { Button, Empty, ErrorLine, Field, type FormState, Input, Mono, PageHeader, Pill, Skeleton, Textarea } from '@/components/ui'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { knownVariants, parseVariants, variantsText } from '@/lib/experiment-variants'
import { formatCount, formatDateTime, formatPercent } from '@/lib/format'

/** A variant is judged by the visitors its own link brought; a discount code names no variant, so redemptions stay out. */
const LINK_ATTRIBUTED_METRICS = new Set<MetricKey>(['signups', 'paid'])

export const Route = createFileRoute('/experiments')({ component: ExperimentsPage })

type ExperimentRow = NonNullable<ReturnType<typeof useQuery<typeof api.private.experiments.list>>>[number]

/** What the new experiment form needs of a persona: who it is, and its defaults, which fill in the control. */
type PersonaOption = { _id: Id<'personas'>; name: string; defaults: StrategyDefault[] | undefined }

function ExperimentsPage() {
  const experiments = useQuery(api.private.experiments.list, {})
  const personas = useQuery(api.private.personas.list, {})
  const [creating, setCreating] = React.useState(false)
  const firstPersona = personas?.[0]
  return (
    <>
      <PageHeader
        title="Experiments"
        lead="One running experiment per persona, picked by its weekly strategy review or set up by you. Every planned episode carries a variant; the analyst decides after each measurement window."
        actions={
          <Button variant="primary" onClick={() => setCreating((value) => !value)}>
            {creating ? 'Close' : 'New experiment'}
          </Button>
        }
      />
      {creating && personas && personas.length === 0 && (
        <div className="mb-6">
          <Empty>An experiment runs on a persona's episodes. Set up a persona first.</Empty>
        </div>
      )}
      {creating && personas && firstPersona && (
        <NewExperimentForm
          personas={personas.map((persona) => ({ _id: persona._id, name: persona.name, defaults: persona.strategy?.defaults }))}
          firstPersonaId={firstPersona._id}
          onDone={() => setCreating(false)}
        />
      )}
      {!experiments && <Skeleton className="h-40" />}
      {experiments && experiments.length === 0 && (
        <Empty action={<Button onClick={() => setCreating(true)}>New experiment</Button>}>
          No experiments yet. Each persona's weekly strategy review picks one from the catalog, or you can set one up now.
        </Empty>
      )}
      <div className="space-y-6">
        {experiments?.map((experiment) => (
          <ExperimentCard key={experiment._id} experiment={experiment} />
        ))}
      </div>
    </>
  )
}

function ExperimentCard(props: { experiment: ExperimentRow }) {
  const stop = useMutation(api.private.experiments.stop)
  const override = useMutation(api.private.experiments.override)
  const [overriding, setOverriding] = React.useState(false)
  const [recording, setRecording] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const experiment = props.experiment
  const leader = [...experiment.stats].sort((a, b) => b.rate - a.rate)[0]
  const tint = experiment.status === 'running' ? 'field-green' : experiment.status === 'decided' ? 'ink' : 'fog'
  // A decision lands once: a second submit while the first is out is ignored, and the backend refuses one on an experiment
  // that is no longer running.
  const submitOverride = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (recording) return
    const form = new FormData(event.currentTarget)
    setError(null)
    setRecording(true)
    try {
      await override({ experimentId: experiment._id, winnerKey: String(form.get('winnerKey')), note: String(form.get('note') ?? '') })
      setOverriding(false)
    } catch (caught) {
      setError(errorMessage(caught))
    }
    setRecording(false)
  }
  // Stopping is refused once the experiment is no longer running (decided by the analyst a moment ago, say), and the card says so.
  const stopExperiment = async () => {
    setError(null)
    try {
      await stop({ experimentId: experiment._id })
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }
  return (
    <article className="border-t border-mist pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">
            {experiment.name}{' '}
            <Pill tint={tint} className="ml-1 align-middle">
              {experiment.status}
            </Pill>
          </h2>
          <p className="mt-0.5 text-ash">{experiment.hypothesis}</p>
          <p className="mt-1 text-xs text-ash">
            {/* Who chose to run it: the persona's own strategy review, or the operator on this page. */}
            {experiment.createdBy === 'analyst'
              ? `Picked by ${experiment.personaName}`
              : `Set up by you for ${experiment.personaName}`}{' '}
            <Mono>@{experiment.personaHandle}</Mono> · {EXPERIMENT_KIND_LABELS[experiment.kind]} on{' '}
            {METRIC_LABELS[experiment.metric].toLowerCase()}
            {LINK_ATTRIBUTED_METRICS.has(experiment.metric) && ' (link-attributed only; code redemptions do not count)'} · decides at{' '}
            {experiment.minExposures} exposures per variant, {formatPercent(experiment.minConfidence, 0)} confidence
          </p>
        </div>
        <div className="flex gap-2">
          {experiment.status === 'running' && (
            <>
              <Button size="sm" onClick={() => setOverriding((value) => !value)}>
                Decide myself
              </Button>
              <Button size="sm" variant="destructive" onClick={() => void stopExperiment()}>
                Stop
              </Button>
            </>
          )}
        </div>
      </div>

      <table className="mt-3 w-full text-sm">
        <thead className="text-xs text-ash">
          <tr className="text-left">
            <th className="py-1 font-medium">Variant</th>
            <th className="py-1 text-right font-medium">Episodes</th>
            <th className="py-1 text-right font-medium">Exposures</th>
            <th className="py-1 text-right font-medium">{METRIC_LABELS[experiment.metric]}</th>
            <th className="py-1 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {experiment.variants.map((variant) => {
            const stat = experiment.stats.find((candidate) => candidate.key === variant.key)
            const winner = experiment.decision?.winnerKey === variant.key
            return (
              <tr key={variant.key} className={cn('border-t border-mist', { 'font-medium': winner })}>
                <td className="py-1.5">
                  <Mono>{variant.key}</Mono> <span className="ml-1">{variant.label}</span>
                  {variant.isControl && <span className="ml-1 text-xs text-ash">control</span>}
                  {winner && (
                    <Pill tint="field-green" className="ml-2">
                      winner
                    </Pill>
                  )}
                  {!experiment.decision && leader?.key === variant.key && (stat?.exposures ?? 0) > 0 && (
                    <span className="ml-2 text-xs text-ash">leading</span>
                  )}
                  <p className="text-xs font-normal text-ash">{variant.description}</p>
                </td>
                <td className="py-1.5 text-right">{stat?.episodes ?? 0}</td>
                <td className="py-1.5 text-right">{formatCount(stat?.exposures ?? 0)}</td>
                <td className="py-1.5 text-right">{formatCount(stat?.successes ?? 0)}</td>
                <td className="py-1.5 text-right">{stat && stat.exposures > 0 ? formatPercent(stat.rate, 2) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {experiment.decision && (
        <p className="mt-3 text-sm">
          <span className="font-medium">{experiment.decision.byOperator ? 'You decided' : 'Decided'}</span>{' '}
          {formatDateTime(experiment.decision.decidedAt)}: {experiment.decision.note}
          {!experiment.decision.byOperator && (
            <span className="tabular text-ash">
              {' '}
              (lift {formatPercent(experiment.decision.lift, 0)}, confidence {confidencePercent(experiment.decision.confidence)}%)
            </span>
          )}
        </p>
      )}

      {/* Gone once the experiment is decided or stopped, by the daily evaluation say, while the form was open. */}
      {overriding && experiment.status === 'running' && (
        <form onSubmit={submitOverride} className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Winner">
            <select name="winnerKey" className="field w-auto pr-8">
              {experiment.variants.map((variant) => (
                <option key={variant.key} value={variant.key}>
                  {variant.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Why" className="min-w-64 flex-1">
            <Input name="note" placeholder="What you saw that the numbers do not show" required />
          </Field>
          <Button type="submit" variant="primary" busy={recording}>
            Record decision
          </Button>
        </form>
      )}
      {error && (
        <div className="mt-2">
          <ErrorLine>{error}</ErrorLine>
        </div>
      )}
    </article>
  )
}

/**
 * The operator's own experiment. Picking a persona and a dimension fills the
 * variants from the catalog, what the persona does now first as the control
 * (shared EXPERIMENT_CATALOG and effectiveVariant). The lines stay editable; a
 * new pick refills them only while they are empty or still the fill, so an
 * edit is never thrown away.
 */
function NewExperimentForm(props: { personas: PersonaOption[]; firstPersonaId: Id<'personas'>; onDone: () => void }) {
  const create = useMutation(api.private.experiments.create)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const [personaId, setPersonaId] = React.useState(props.firstPersonaId)
  const [kind, setKind] = React.useState<ExperimentKind>('hook')
  const defaultsOf = (id: Id<'personas'>) => props.personas.find((persona) => persona._id === id)?.defaults
  const [variants, setVariants] = React.useState(() => variantsText(knownVariants('hook', defaultsOf(props.firstPersonaId))))
  const pick = (next: { personaId: Id<'personas'>; kind: ExperimentKind }) => {
    const filled = variantsText(knownVariants(kind, defaultsOf(personaId)))
    if (variants.trim() === '' || variants === filled) setVariants(variantsText(knownVariants(next.kind, defaultsOf(next.personaId))))
    setPersonaId(next.personaId)
    setKind(next.kind)
  }
  const pickPersona = (value: string) => {
    const persona = props.personas.find((candidate) => candidate._id === value)
    if (persona === undefined) return
    pick({ personaId: persona._id, kind })
  }
  const pickKind = (value: string) => {
    const next = EXPERIMENT_KINDS.find((candidate) => candidate === value)
    if (next === undefined) return
    pick({ personaId, kind: next })
  }
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    setState({ status: 'saving' })
    try {
      await create({
        personaId,
        name: text('name'),
        hypothesis: text('hypothesis'),
        kind,
        metric: text('metric') as MetricKey,
        variants: parseVariants(variants, knownVariants(kind, defaultsOf(personaId))),
        minExposures: Number(form.get('minExposures') ?? 500),
        minConfidence: Number(form.get('minConfidence') ?? 0.9),
      })
      props.onDone()
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <form onSubmit={submit} className="card mb-6 grid gap-4 sm:grid-cols-2">
      <Field label="Persona">
        <select name="personaId" className="field" value={personaId} onChange={(event) => pickPersona(event.target.value)} required>
          {props.personas.map((persona) => (
            <option key={persona._id} value={persona._id}>
              {persona.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Name">
        <Input name="name" required placeholder="Confession hooks" />
      </Field>
      <Field label="Hypothesis" className="sm:col-span-2">
        <Input name="hypothesis" required placeholder="“I was wrong about…” hooks beat “How to…” hooks on click rate" />
      </Field>
      <Field label="Dimension">
        <select name="kind" className="field" value={kind} onChange={(event) => pickKind(event.target.value)}>
          {EXPERIMENT_KINDS.map((option) => (
            <option key={option} value={option}>
              {EXPERIMENT_KIND_LABELS[option]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Metric">
        <select name="metric" className="field" defaultValue="clicks">
          {METRIC_KEYS.map((metric) => (
            <option key={metric} value={metric}>
              {METRIC_LABELS[metric]}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Variants"
        hint="One per line, “Label: what the writer does”. The first line is the control, filled in with what the persona does now. Keep two or three: each variant needs its own exposures."
        className="sm:col-span-2"
      >
        <Textarea name="variants" required value={variants} onChange={(event) => setVariants(event.target.value)} className="min-h-32" />
      </Field>
      <Field label="Exposures per variant before deciding">
        <Input name="minExposures" type="number" min={10} defaultValue={500} />
      </Field>
      <Field label="Confidence" hint="0 to 1">
        <Input name="minConfidence" type="number" min={0.5} max={0.99} step={0.01} defaultValue={0.9} />
      </Field>
      {state.status === 'error' && (
        <div className="sm:col-span-2">
          <ErrorLine>{state.message}</ErrorLine>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" busy={state.status === 'saving'}>
          Start experiment
        </Button>
        <Button variant="ghost" onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
