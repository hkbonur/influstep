import { api } from '@influstep/convex/_generated/api'
import type { Doc, Id } from '@influstep/convex/_generated/dataModel'
import {
  DEFAULT_LENGTH_MIX,
  VOICE_EXAMPLES_MAX,
  VOICE_EXAMPLES_MIN,
  VOICE_SAMPLE_MIN,
  VOICE_TRAITS_MAX,
  X_PROVIDER_KEY,
  voiceEditProblems,
  type Habit,
  type Voice,
  type VoiceEdit,
} from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { HistorySection } from '@/components/account-history'
import { LengthMixBar } from '@/components/length-mix-bar'
import { PostParts } from '@/components/post-parts'
import { JobState } from '@/components/status'
import {
  Button,
  Empty,
  ErrorLine,
  Eyebrow,
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
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { formatCount, formatDate, languageName, plural, relativeTime } from '@/lib/format'

// `$personaId_`: the same /personas/:id/voice address, outside the persona page's route. The persona page renders no
// outlet, so a route nested under it would show the persona page and never this one.
export const Route = createFileRoute('/personas/$personaId_/voice')({ component: VoicePage })

type PersonaData = NonNullable<FunctionReturnType<typeof api.private.personas.get>>
type Job = Doc<'jobs'>

/** How many of the account's best originals the examples section lists after the examples, which all come first. */
const TOP_POSTS_LIMIT = 20

/** How many of those the list shows before Show more. */
const TOP_POSTS_SHOWN = 5

/** Emoji and hashtag habits as plain words. */
const HABIT_WORDS: Record<Habit, string> = { never: 'Never', rare: 'Rarely', often: 'Often' }

/**
 * An X persona taking over an account (docs/plan.md, slice 5): the account,
 * its imported history, the voice the analyst learned from it, and the
 * example posts the writer imitates (DESIGN.md, Voice page).
 */
function VoicePage() {
  const params = Route.useParams()
  const personaId = params.personaId as Id<'personas'>
  const data = useQuery(api.private.personas.get, { personaId })
  if (data === undefined) return <Skeleton className="h-96" />
  if (data === null) return <p className="text-ash">This persona does not exist.</p>
  const persona = data.persona
  const header = (
    <PageHeader
      title={`Voice of ${persona.name}`}
      lead="How the account writes on X, learned from its own posts."
      actions={
        <LinkButton to="/personas/$personaId" params={{ personaId }} variant="ghost">
          Open persona
        </LinkButton>
      }
    />
  )
  if (!persona.formats.some((format) => format.platform === 'x')) {
    return (
      <>
        {header}
        <p className="text-ash">The voice is for X only, and {persona.name} does not post on X.</p>
      </>
    )
  }
  return (
    <>
      {header}
      <VoiceSections data={data} />
    </>
  )
}

/** Split from the page so the account queries run only for a persona on X. */
function VoiceSections(props: { data: PersonaData }) {
  const persona = props.data.persona
  // The history's totals are what the page reads (the query takes at least one post); the posts it lists come from topPosts.
  const history = useQuery(api.private.account.history, { personaId: persona._id, limit: 1 })
  const topPosts = useQuery(api.private.account.topPosts, { personaId: persona._id, limit: TOP_POSTS_LIMIT })
  // The newest 50 of the persona's jobs: the page's two jobs are found among them, where the persona's own 12 can miss them.
  const jobs = useQuery(api.private.jobs.recent, { personaId: persona._id })
  const providers = useQuery(api.private.providers.status, {})
  if (history === undefined || topPosts === undefined || jobs === undefined || providers === undefined) {
    return <Skeleton className="h-96" />
  }
  const newestJob = (kind: Job['kind']): Job | null => {
    const job = jobs.find((candidate) => candidate.kind === kind)
    return job === undefined ? null : job
  }
  return (
    <div className="max-w-[64rem] space-y-10">
      <AccountSection persona={persona} checklist={props.data.checklist} />
      <HistorySection
        personaId={persona._id}
        totals={history.totals}
        clearing={history.clearing}
        importJob={newestJob('import_x_history')}
        mock={providers.mode === 'mock'}
      />
      <VoiceSection persona={persona} originals={history.totals.originals} job={newestJob('learn_voice')} />
      <ExamplesSection posts={topPosts} />
    </div>
  )
}

/**
 * The account and whether it is connected. The persona query lists only open
 * checklist items, and every persona that gains X gets the connect item
 * (core/checklist.ts), so an X persona with no open connect item has done it.
 */
function AccountSection(props: { persona: Doc<'personas'>; checklist: PersonaData['checklist'] }) {
  const connectItem = props.checklist.find((item) => item.action?.kind === 'set_provider_key' && item.action.key === X_PROVIDER_KEY)
  return (
    <section>
      <Eyebrow className="mb-3">Account</Eyebrow>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5">
        <dt className="text-xs text-ash">On X</dt>
        <dd>
          <Mono>@{props.persona.handle}</Mono>
        </dd>
        <dt className="text-xs text-ash">Connection</dt>
        <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {connectItem ? (
            <>
              <Pill tint="alert-amber">Waiting on you</Pill>
              <span>{connectItem.title}.</span>
            </>
          ) : (
            <span>Connected, ticked off on the checklist.</span>
          )}
          <Link to="/checklist" className="text-xs text-ash underline hover:text-ink">
            Checklist
          </Link>
        </dd>
      </dl>
    </section>
  )
}

/**
 * The voice: learn it from the history, then edit what the LLM wrote
 * (language, summary, traits). The length mix and the habits are counted from
 * the posts, so they are shown, not edited; learning again recounts them.
 */
function VoiceSection(props: { persona: Doc<'personas'>; originals: number; job: Job | null }) {
  const learnVoice = useMutation(api.private.account.learnVoice)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const voice = props.persona.voice
  const jobBusy = props.job?.status === 'queued' || props.job?.status === 'running'
  const tooFew = props.originals < VOICE_SAMPLE_MIN
  const learn = async () => {
    setState({ status: 'saving' })
    try {
      await learnVoice({ personaId: props.persona._id })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <section>
      <Eyebrow className="mb-3">Voice</Eyebrow>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button
          variant={voice ? 'outline' : 'primary'}
          size="sm"
          disabled={tooFew}
          busy={state.status === 'saving' || jobBusy}
          onClick={learn}
        >
          {voice ? 'Learn again' : 'Learn the voice'}
        </Button>
        {voice && (
          <span className="text-xs text-ash">
            Learned from <span className="tabular">{voice.sampleSize}</span> posts, {relativeTime(voice.learnedAt)}.
          </span>
        )}
      </div>
      {/* Visible text, not a tooltip: a disabled button does not reliably show one. */}
      {tooFew && (
        <p className="mt-1.5 text-xs text-ash">
          The analyst needs at least {VOICE_SAMPLE_MIN} of the account's own posts, replies not counted;{' '}
          {plural(props.originals, 'there is', 'there are')} <span className="tabular">{props.originals}</span>.
        </p>
      )}
      {voice && !tooFew && <p className="mt-1.5 text-xs text-ash">Learning again replaces the language, summary, traits and examples.</p>}
      {/* Mounted before the first job exists, so the job appearing is announced, and every status after it, done included. */}
      <div aria-live="polite" className="mt-2">
        {props.job && <JobState job={props.job} />}
      </div>
      {state.status === 'error' && (
        <div className="mt-2">
          <ErrorLine>{state.message}</ErrorLine>
        </div>
      )}
      {voice ? <VoiceDetails personaId={props.persona._id} voice={voice} /> : <NotLearned />}
    </section>
  )
}

function VoiceDetails(props: { personaId: Id<'personas'>; voice: Voice }) {
  const voice = props.voice
  return (
    <div className="mt-5 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
      {/* Keyed on the voice it edits: a save or a new learn remounts it with the stored values. */}
      <VoiceForm
        key={[voice.learnedAt, voice.language, voice.summary, ...voice.traits].join('\u0000')}
        personaId={props.personaId}
        voice={voice}
      />
      <div className="space-y-5">
        <div>
          <h3 className="mb-2 text-xs font-medium text-graphite">Length mix</h3>
          <LengthMixBar mix={voice.lengthMix} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-xs text-ash">Emoji</dt>
          <dd>{HABIT_WORDS[voice.emoji]}</dd>
          <dt className="text-xs text-ash">Hashtags</dt>
          <dd>{HABIT_WORDS[voice.hashtags]}</dd>
        </dl>
        <p className="text-xs text-ash">Counted from the account's own posts. The planner draws each week's lengths from this mix.</p>
      </div>
    </div>
  )
}

/** Without a voice the writer keeps its first behavior, and the page says what that is. */
function NotLearned() {
  return (
    <div className="mt-5 max-w-[40rem] space-y-3">
      <p>
        Not learned yet. Until it is, the writer posts in English in the persona bible's tone, and the planner uses the default length mix.
      </p>
      <LengthMixBar mix={DEFAULT_LENGTH_MIX} />
    </div>
  )
}

/**
 * What the LLM wrote, edited in place. Traits are one per line; a blank line
 * is spacing, not an empty trait, so it is dropped. The form checks the edit
 * the way the backend does (shared voiceEditProblems) and lists every problem
 * while the operator types, so Save only sends an edit the backend takes. A
 * field with a problem is marked invalid and described by the list, which sits
 * in a polite live region that stays mounted, so a problem is heard as it
 * appears.
 */
function VoiceForm(props: { personaId: Id<'personas'>; voice: Voice }) {
  const updateVoice = useMutation(api.private.account.updateVoice)
  const [language, setLanguage] = React.useState(props.voice.language)
  const [summary, setSummary] = React.useState(props.voice.summary)
  const [traitsText, setTraitsText] = React.useState(props.voice.traits.join('\n'))
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const problemsId = React.useId()
  const edit = {
    language: language.trim(),
    summary: summary.trim(),
    traits: traitsText
      .split('\n')
      .map((trait) => trait.trim())
      .filter((trait) => trait.length > 0),
  }
  const problems = voiceEditProblems(edit)
  const dirty =
    edit.language !== props.voice.language ||
    edit.summary !== props.voice.summary ||
    edit.traits.join('\n') !== props.voice.traits.join('\n')
  const invalid = (field: keyof VoiceEdit) => problems.some((problem) => problem.field === field)
  const problemProps = (field: keyof VoiceEdit) => ({
    'aria-invalid': invalid(field),
    'aria-describedby': invalid(field) ? problemsId : undefined,
  })
  const name = languageName(edit.language)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setState({ status: 'saving' })
    try {
      await updateVoice({ personaId: props.personaId, ...edit })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Language" hint={name === null ? 'A language tag such as en, nb or tr.' : name}>
        <Input
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          required
          {...problemProps('language')}
          className="w-40 font-mono"
        />
      </Field>
      <Field label="Summary">
        <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} required {...problemProps('summary')} />
      </Field>
      <Field label="Traits" hint={`One per line, at most ${VOICE_TRAITS_MAX}.`}>
        <Textarea
          value={traitsText}
          onChange={(event) => setTraitsText(event.target.value)}
          required
          {...problemProps('traits')}
          className="min-h-32"
        />
      </Field>
      <div aria-live="polite">
        {problems.length > 0 && (
          <ul id={problemsId} className="space-y-0.5 text-xs text-signal-red-deep">
            {problems.map((problem) => (
              <li key={problem.message}>{problem.message}</li>
            ))}
          </ul>
        )}
      </div>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      <Button
        type="submit"
        variant={dirty ? 'primary' : 'outline'}
        busy={state.status === 'saving'}
        disabled={!dirty || problems.length > 0}
      >
        Save
      </Button>
    </form>
  )
}

/**
 * The posts the writer imitates, then the account's best originals to pick
 * more from. topPosts returns every example first, then the top originals, so
 * the split below is the whole of both.
 *
 * Both are one list, examples first and a "Top posts" separator between, with
 * every row keyed by its post in one array: ticking Example moves the row
 * within the list, so React moves its node instead of mounting a new one, and
 * focus stays on the box the operator ticked.
 */
function ExamplesSection(props: { posts: Doc<'accountPosts'>[] }) {
  const examples = props.posts.filter((post) => post.example)
  const others = props.posts.filter((post) => !post.example)
  const full = examples.length >= VOICE_EXAMPLES_MAX
  const [showAll, setShowAll] = React.useState(false)
  // The best few are enough to pick from; the rest wait behind Show more.
  const shown = showAll ? others : others.slice(0, TOP_POSTS_SHOWN)
  const rows = [
    ...examples.map((post) => <AccountPostRow key={post._id} post={post} full={full} />),
    others.length > 0 && <TopPostsSeparator key="top-posts" />,
    ...shown.map((post) => <AccountPostRow key={post._id} post={post} full={full} />),
  ]
  return (
    <section>
      <Eyebrow className="mb-1">Examples</Eyebrow>
      <p className="mb-3 max-w-[65ch] text-xs text-ash">
        The writer imitates these in style, never copies them. <span className="tabular">{examples.length}</span> of {VOICE_EXAMPLES_MAX}
        {examples.length < VOICE_EXAMPLES_MIN && `; mark at least ${VOICE_EXAMPLES_MIN}`}
        {full && '; untick one to mark another'}.
      </p>
      {props.posts.length === 0 && <Empty>None of the account's own posts are here yet. Import its history above.</Empty>}
      {props.posts.length > 0 && (
        // Without examples the separator opens the list, so the list draws no line above it.
        <ul className={cn('divide-y divide-mist border-b border-mist', { 'border-t': examples.length > 0 })}>{rows}</ul>
      )}
      {others.length > shown.length && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAll(true)}>
          Show <span className="tabular">{others.length - shown.length}</span> more
        </Button>
      )}
    </section>
  )
}

/** Not a post: a heading between the examples and the top posts, so a screen reader counts only posts as list items. */
function TopPostsSeparator() {
  return (
    <li role="presentation" className="pt-6 pb-1">
      <h3 className="text-xs font-medium text-graphite">Top posts</h3>
    </li>
  )
}

/**
 * One imported post with its engagement and the Example toggle. The checked
 * state is the server's: the box moves once the save lands, and a refused save
 * says why on the row, in a polite live region that stays mounted. While a
 * save is out the box is aria-busy and ignores clicks rather than going
 * disabled, which would drop focus. With eight examples marked, an unmarked
 * box waits until one is unticked.
 */
function AccountPostRow(props: { post: Doc<'accountPosts'>; full: boolean }) {
  const setExample = useMutation(api.private.account.setExample)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const textId = React.useId()
  const post = props.post
  const saving = state.status === 'saving'
  const toggle = async (example: boolean) => {
    // The box stays controlled by the server's value, so an ignored click leaves it as it was.
    if (saving) return
    setState({ status: 'saving' })
    try {
      await setExample({ accountPostId: post._id, example })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <li className="flex items-start gap-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div id={textId}>
          <PostParts parts={post.parts} />
        </div>
        <p className="tabular font-mono text-[11px] text-ash">
          {formatDate(post.postedAt)} · {formatCount(post.likes)} {plural(post.likes, 'like', 'likes')} · {formatCount(post.reposts)}{' '}
          {plural(post.reposts, 'repost', 'reposts')}
        </p>
        <div aria-live="polite">{state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}</div>
      </div>
      <label className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs">
        <input
          type="checkbox"
          className="size-3.5 accent-ink"
          checked={post.example}
          disabled={props.full && !post.example}
          aria-busy={saving}
          aria-describedby={textId}
          onChange={(event) => toggle(event.target.checked)}
        />
        Example
      </label>
    </li>
  )
}
