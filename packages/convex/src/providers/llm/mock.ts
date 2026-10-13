import {
  CARD_TITLE_MAX,
  POST_LENGTHS,
  SHORT_POST_MAX,
  WORDS_PER_SECOND,
  lengthProblem,
  parseChatIntent,
  xLength,
  type Beat,
  type Delivery,
  type Habit,
  type LengthMix,
  type PostIntent,
  type PostLength,
} from '@influstep/shared'
import {
  PRESENTER_TOOL,
  type AccountPostSample,
  type DraftBeat,
  type LlmProvider,
  type PostBrief,
  type PostDraft,
  type ScriptBrief,
  type ScriptDraft,
  type TaskReportArgs,
  type TaskSignal,
  type VoiceBrief,
  type VoiceDraft,
} from './types'

/**
 * A template writer. Deterministic from the brief, so a seeded demo and a
 * test read the same script twice. It is honest about being a mock: every
 * script is about the concept, and its hook and closing line follow the
 * style in force (`brief.style`), so an experiment or a new default visibly
 * changes the script.
 *
 * The beats are the script, written to the rules the real writer is held
 * to: the hook alone on the first beat, a fix that grows with the format's
 * length, the sponsor in a beat when the slot carries one, and the call to
 * action closing the last beat. A format too short for the full sponsor
 * lines gets compact ones, so every sponsor segment fits from the shortest
 * format up. The beats follow the delivery. The research (the morning brief
 * and the problem log) is left unread, for scripts and posts alike: the
 * templates have no place to weave it in.
 *
 * A post opens with its topic too, follows its intent and length, and every
 * part is cut to the limit the brief gives it, so a mock post always passes
 * X's rules. A voice in Norwegian or Turkish puts a short native phrase in
 * front, so a smoke test shows the language reached the writer. A learned
 * voice is the counted stats in words, in the persona's tone.
 *
 * The chat reads a message with the shared English parser, and a task report
 * lists what its data holds, saying so plainly when it holds nothing.
 */
export const mockLlm: LlmProvider = {
  name: 'mock',
  async writeScript(brief: ScriptBrief): Promise<ScriptDraft> {
    const topic = brief.signals[0]?.title ?? brief.concept
    const full = beatsFor(brief, topic, { compact: false })
    return {
      title: titleFor(brief.pillar, topic),
      description: descriptionFor(brief, topic),
      shotPlan: lengthProblem(full, brief.format.lengthSec) === null ? full : beatsFor(brief, topic, { compact: true }),
    }
  },
  async writePost(brief: PostBrief): Promise<PostDraft> {
    const topic = brief.signals[0]?.title ?? brief.concept
    const title = titleFor(brief.pillar, topic)
    const parts = postPartsFor(brief, {
      topic,
      // A post planned before intents and lengths existed is the how-to this mock always wrote, at its kind's length.
      intent: brief.intent ?? 'teach',
      length: brief.length ?? (brief.kind === 'thread' ? 'long' : 'medium'),
    })
    if (brief.kind === 'image') return { title, post: { parts, cardTitle: fit(topic, CARD_TITLE_MAX) } }
    return { title, post: { parts } }
  },
  async learnVoice(brief: VoiceBrief): Promise<VoiceDraft> {
    const { stats } = brief
    const mostly = LENGTH_WORDS[dominantLength(stats.lengthMix)]
    return {
      language: majorityLanguage([...brief.top, ...brief.newest]),
      summary: `${brief.persona.name} mostly writes ${mostly}, in a ${brief.persona.tone} tone. Learned from ${stats.sampleSize} of the account's own posts.`,
      traits: [`Mostly ${mostly}`, EMOJI_TRAITS[stats.emoji], HASHTAG_TRAITS[stats.hashtags], `Tone: ${brief.persona.tone}`],
    }
  },
  async reply(args) {
    const last = args.history.at(-1)
    if (args.directive) return `Noted. From now on: "${args.directive}". The next scripts follow it.`
    if (!last) return `Hi, I am ${args.persona.name}. Tell me what to focus on, or ask what is planned.`
    // A conversation changes nothing, so the reply says what would: a directive, a plan change or a task.
    return `Nothing changed. Say "focus on ..." or "stop ..." for a directive, ask me to move, drop or replace an episode, or ask for a research brief, a comment digest or an analytics summary.`
  },
  async interpret(args) {
    return parseChatIntent(args.text)
  },
  async taskReport(args) {
    return taskReportText(args)
  },
}

/** How many titles a mock report quotes before it says how many more there are. */
const REPORT_TITLES = 3

function taskReportText(args: TaskReportArgs): string {
  if (args.task === 'research_brief') {
    const on = args.topic === null ? '' : ` on ${args.topic}`
    if (args.data.signals.length === 0) return `No new signals${on}.`
    return `${counted(args.data.signals.length, 'new signal')}${on}: ${quotedTitles(args.data.signals, args.data.signals.length)}.`
  }
  if (args.task === 'comment_digest') {
    const window = `in the last ${args.data.days} days`
    if (args.data.total === 0) return `No comments ${window}.`
    return `${counted(args.data.total, 'comment')} ${window}. Most liked: ${quotedTitles(args.data.comments, args.data.total)}.`
  }
  const { funnel, days, currency } = args.data
  if (funnel.views === 0 && funnel.clicks === 0 && funnel.signups === 0 && funnel.paid === 0)
    return `No views, clicks or conversions in the last ${days} days.`
  const mock = funnel.mock ? ' Some of it is mock data.' : ''
  return `Last ${days} days: ${counted(funnel.views, 'view')}, ${counted(funnel.follows, 'follow')}, ${counted(funnel.clicks, 'click')}, ${counted(funnel.signups, 'signup')}, ${funnel.paid} paid (${funnel.value} ${currency}).${mock}`
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** The first titles, quoted, and how many of `total` are left unquoted. */
function quotedTitles(signals: TaskSignal[], total: number): string {
  const quoted = signals
    .slice(0, REPORT_TITLES)
    .map((signal) => `"${signal.title}"`)
    .join('; ')
  const more = total - Math.min(signals.length, REPORT_TITLES)
  return more > 0 ? `${quoted}; and ${more} more` : quoted
}

/** A short phrase in the voice's language, so the language visibly took effect; English and the rest get none. */
const LANGUAGE_PREFIXES: Partial<Record<string, string>> = { nb: 'Kort fortalt:', tr: 'Kısaca:' }

interface PostText {
  subject: string
  sponsor: string | null
}

/** A one-liner per intent, with the sponsor in it when the post carries one. Every ask is a question. */
const SHORT_LINES: Record<PostIntent, (text: PostText) => string> = {
  ask: (text) =>
    text.sponsor
      ? `How do you collect what a flow needs from a customer? I use ${text.sponsor}.`
      : `What breaks first in your ${text.subject}?`,
  inform: (text) =>
    text.sponsor
      ? `Worth knowing: ${text.sponsor} sends a customer's answers straight back into the flow.`
      : `Worth knowing: most ${text.subject} failures start at the first step.`,
  share: (text) =>
    text.sponsor
      ? `Found a keeper: ${text.sponsor} collects what my flows need from customers.`
      : `Found a ${text.subject} habit worth keeping: name every step.`,
  teach: (text) =>
    text.sponsor
      ? `Tip: let ${text.sponsor} collect what the flow needs from a customer.`
      : `Tip: test the failure path of your ${text.subject} first.`,
}

/** A full post per intent: the hook after the topic, then the body. Every ask hook is a question. */
const MEDIUM_LINES: Record<PostIntent, { hook: string; body: (text: PostText) => string }> = {
  ask: {
    hook: 'what is your take?',
    body: (text) =>
      `What is the one step in your ${text.subject} that still breaks, and how do you catch it before a customer does? I read every reply.`,
  },
  inform: {
    hook: 'what changed and why it matters.',
    body: () =>
      'The default moved, and flows built on the old one fail quietly. It matters because nobody gets an alert. Check yours this week.',
  },
  share: {
    hook: 'something I found.',
    body: () =>
      "A plain log view that shows each step's input and output. It cut my debugging time in half. Worth ten minutes of your week.",
  },
  teach: {
    hook: 'how to fix it today.',
    body: () => 'Run it once and watch where it stops. Read the log before you touch the config. Then fix the one step that stops.',
  },
}

/** A thread per intent: the opener after the topic, then numbered parts. */
const THREAD_LINES: Record<PostIntent, (text: PostText) => string[]> = {
  ask: (text) => [
    'what would you do? Three questions, answer any one.',
    `1. Where does your ${text.subject} stop most often?`,
    '2. What do you check first when it does?',
    '3. What would you automate next if it never broke?',
  ],
  inform: () => [
    'what changed and why it matters.',
    '1. What changed: the default moved, and old flows fail quietly.',
    '2. Why it matters: nobody gets an alert, so customers find it first.',
    '3. What to do: run each flow once this week and read the log.',
  ],
  share: () => [
    'three things I found this week.',
    "1. A log view that shows every step's input and output.",
    '2. A habit: write down what you changed before the next change.',
    '3. A rule: one flow, one owner, one alert.',
  ],
  teach: () => [
    'the short version.\nThree steps, in order.',
    '1. Run it once and watch where it stops. Read the log before you touch the config.',
    '2. Fix it the plain way, no plugins. Then test the failure path, not just the one that works.',
    '3. Keep the fix small enough to undo.',
  ],
}

function postPartsFor(brief: PostBrief, args: { topic: string; intent: PostIntent; length: PostLength }): string[] {
  const prefix = brief.voice ? LANGUAGE_PREFIXES[brief.voice.language.toLowerCase().split('-')[0] ?? ''] : undefined
  const lead = (line: string) => (prefix ? `${prefix} ${line}` : line)
  const text: PostText = { subject: brief.pillar.toLowerCase(), sponsor: brief.sponsorSegment === 'none' ? null : brief.sponsorName }
  const sponsorLine = text.sponsor ? `I collect what a flow needs from a customer with ${text.sponsor}.` : ''
  if (args.length === 'short') return [fit(lead(SHORT_LINES[args.intent](text)), Math.min(SHORT_POST_MAX, brief.partLimit))]
  if (args.length === 'medium') {
    const lines = MEDIUM_LINES[args.intent]
    // The sponsor goes before the body, so cutting to the limit never cuts the mention.
    const part = fit([lead(`${args.topic}: ${lines.hook}`), sponsorLine, lines.body(text)].filter(Boolean).join('\n'), brief.partLimit)
    if (xLength(part) <= SHORT_POST_MAX) throw new Error(`the mock writer's full post came out as a one-liner: ${part}`)
    return [part]
  }
  const [opener, ...rest] = THREAD_LINES[args.intent](text)
  const last = rest.pop()
  if (opener === undefined || last === undefined) throw new Error('a mock thread needs an opener and a last part')
  // Nothing is appended on X: the last part ends on its own point, with the sponsor mention when the slot carries one.
  return [lead(`${args.topic}: ${opener}`), ...rest, [last, sponsorLine].filter(Boolean).join(' ')].map((part) =>
    fit(part, brief.partLimit)
  )
}

const LENGTH_WORDS: Record<PostLength, string> = { short: 'one-liners', medium: 'full posts', long: 'threads' }

const EMOJI_TRAITS: Record<Habit, string> = {
  never: 'No emoji',
  rare: 'An emoji now and then, never more than one',
  often: 'Emoji in most posts',
}

const HASHTAG_TRAITS: Record<Habit, string> = {
  never: 'No hashtags',
  rare: 'A hashtag now and then, at the end',
  often: 'Hashtags on most posts',
}

/** The length with the largest share; a tie goes to the shorter one. */
function dominantLength(mix: LengthMix): PostLength {
  let best: PostLength = 'short'
  for (const length of POST_LENGTHS) if (mix[length] > mix[best]) best = length
  return best
}

/** The language most of the posts carry; English when X named none. A tie goes to the language seen first. */
function majorityLanguage(posts: AccountPostSample[]): string {
  const counts = new Map<string, number>()
  for (const post of posts) {
    if (post.lang === null) continue
    counts.set(post.lang, (counts.get(post.lang) ?? 0) + 1)
  }
  let best: { lang: string; count: number } | null = null
  for (const [lang, count] of counts) if (!best || count > best.count) best = { lang, count }
  return best?.lang ?? 'en'
}

function howToHook(subject: string): string {
  return `How to ${subject} in under a minute.`
}

/** A hook per catalog hook style, each one sentence, so it is the first beat's whole voiceover. */
const HOOKS: Partial<Record<string, (subject: string) => string>> = {
  howto: howToHook,
  question: (subject) => `Why does ${subject} break for everyone?`,
  wrong: (subject) => `I was wrong about ${subject}.`,
  number: (subject) => `3 things about ${subject}.`,
  result: (subject) => `This is what ${subject} looks like when it works.`,
}

/**
 * The hook of the hook style in force. It reads the style, never the bare
 * variant key: a call to action keyed `comment` says nothing about the hook.
 */
function hookFor(brief: ScriptBrief, topic: string): string {
  const subject = topic.toLowerCase()
  const hook = HOOKS[brief.style.hook.key]
  // An operator's own hook variant has no template here: the mock opens with the control's how-to,
  // and the real writer follows the variant's description.
  if (hook === undefined) return howToHook(subject)
  return hook(subject)
}

/**
 * The closing line of the call to action in force, full or compact. A
 * sponsored slot asks the viewer to try the sponsor first; a slot without one
 * never names it. The compact lines stay at two or three words, so the
 * longest hook with the compact sponsor demo still fits the shortest format.
 */
function ctaFor(brief: ScriptBrief, args: { compact: boolean }): string {
  const sponsor = brief.sponsorSegment === 'none' ? null : brief.sponsorName
  const key = brief.style.cta.key
  if (key === 'comment') {
    if (args.compact) return 'Your take?'
    if (sponsor) return `Try ${sponsor}. What would your flow ask a customer for? Tell me in the comments.`
    return 'Which part of this trips you up? Tell me in the comments.'
  }
  if (key === 'link') {
    if (args.compact) return 'Link below.'
    if (sponsor) return `Try ${sponsor}. The link is in the description.`
    return 'The link is in the description.'
  }
  // `follow` is the control. An operator's own call to action has no template here either: the mock closes
  // the way it always has, and the real writer follows the variant's description.
  if (args.compact) return 'Follow for more.'
  if (sponsor) return `Try ${sponsor}, and follow for the next one.`
  return `Follow ${brief.persona.name} for more ${brief.pillar.toLowerCase()}.`
}

function titleFor(pillar: string, topic: string): string {
  return `${topic} (${pillar})`.slice(0, 90)
}

/** Drops whole words from the end until the text weighs at most `limit` on X, and marks the cut with an ellipsis. */
function fit(text: string, limit: number): string {
  if (xLength(text) <= limit) return text
  const words = text.split(' ')
  while (words.length > 1 && xLength(`${words.join(' ')}…`) > limit) words.pop()
  return `${words.join(' ')}…`
}

/** What the script says besides the fix: the hook, the sponsor line its segment asks for, and the call to action. */
interface ScriptLines {
  hook: string
  /** One sentence inside the fix that names the sponsor and says it is sponsored. */
  mention: string | null
  /** The voiceover of the sponsor's own beat. */
  demo: string | null
  cta: string
}

/** The full lines, or the compact ones for a format too short to hold them. */
function linesFor(brief: ScriptBrief, topic: string, args: { compact: boolean }): ScriptLines {
  const hook = hookFor(brief, topic)
  const cta = ctaFor(brief, args)
  const sponsor = brief.sponsorName
  if (brief.sponsorSegment === 'none') return { hook, mention: null, demo: null, cta }
  if (brief.sponsorSegment === 'mention') {
    const mention = args.compact
      ? `Sponsored by ${sponsor}.`
      : `This one is sponsored by ${sponsor}: forms your workflows and AI agents send to one customer and get back as answers.`
    return { hook, mention, demo: null, cta }
  }
  const demo = args.compact
    ? `Sponsored by ${sponsor}: a request, a prefilled form, the answers back.`
    : `This part is sponsored by ${sponsor}. When the workflow needs something from a customer, it creates a request, the customer gets a prefilled form, and the answers come straight back into the flow. Here it is.`
  return { hook, mention: null, demo, cta }
}

/**
 * Talking head: the presenter speaks every beat. Screen with avatar: the
 * presenter says the hook, then the screens. Screen only: every beat is a
 * screen. A demo is its own beat on the sponsor's site under every delivery,
 * and a talking head speaks it to camera all the same. The fix shows the
 * library's asset that fits the topic, when one does (`assetFor`).
 */
function beatsFor(brief: ScriptBrief, topic: string, args: { compact: boolean }): DraftBeat[] {
  const lines = linesFor(brief, topic, args)
  const fixed = [lines.hook, lines.mention, lines.demo, lines.cta].filter((line) => line !== null).join(' ')
  const body = bodyFor(brief, { budget: Math.round(brief.format.lengthSec * WORDS_PER_SECOND) - wordCount(fixed) })
  const fix = lines.mention === null ? body : `${body} ${lines.mention}`
  const opening = openingBeat(brief.format.delivery, lines.hook)
  const asset = assetFor(brief, topic)
  const fixScreen = {
    ...(brief.format.delivery === 'talking_head' ? { tool: PRESENTER_TOOL, url: '' } : { tool: 'n8n', url: 'http://localhost:5678' }),
    ...(asset === undefined ? {} : { asset }),
  }
  if (lines.demo === null) return [opening, { title: 'The fix', voiceover: `${fix} ${lines.cta}`, ...fixScreen }]
  return [
    opening,
    { title: 'The fix', voiceover: fix, ...fixScreen },
    { title: `${brief.sponsorName} demo`, voiceover: `${lines.demo} ${lines.cta}`, tool: brief.sponsorName, url: brief.sponsorUrl },
  ]
}

/**
 * The first asset of the library, in the brief's order, with a tag the
 * concept, the pillar or the topic says word for word: the mock's stand-in
 * for a writer choosing a picture.
 */
function assetFor(brief: ScriptBrief, topic: string): string | undefined {
  const text = ` ${wordsOf(`${brief.concept} ${brief.pillar} ${topic}`)} `
  return brief.assets.find((asset) => asset.tags.some((tag) => wordsOf(tag) !== '' && text.includes(` ${wordsOf(tag)} `)))?.name
}

/** Lowercase words separated by one space, so "Error-workflow" and "error workflow" read the same. */
function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(' ')
}

/** The first beat says the hook and nothing else, so the hook is its first sentence. */
function openingBeat(delivery: Delivery, hook: string): Beat {
  if (delivery === 'screen_only') return { title: 'The problem', voiceover: hook, tool: 'browser', url: 'https://news.ycombinator.com' }
  return { title: 'The hook', voiceover: hook, tool: PRESENTER_TOOL, url: '' }
}

/**
 * What the video shows, in the persona's voice, and nothing else. It becomes
 * every video publication's body, so it never quotes a directive: the
 * operator's words can carry a link or run past the body's limit, and the
 * writer's checks would then fail every script of the persona.
 */
function descriptionFor(brief: ScriptBrief, topic: string): string {
  const sentences = [`Where ${topic.toLowerCase()} breaks, and the plain way to fix it.`]
  if (brief.sponsorSegment === 'demo') sentences.push(`Then I show how ${brief.sponsorName} collects what a flow needs from a customer.`)
  return sentences.join(' ')
}

/** Steps a longer format keeps adding until the word budget is spent. Cycled, so a long tutorial reads as a tutorial. */
const MORE_STEPS = [
  'Run it once and watch where it stops.',
  'Read the log before you touch the config.',
  'Rename the step so the next person knows what it does.',
  'Test the failure path, not just the one that works.',
  'Keep the fix small enough to undo.',
  'Save, run it again, and check the output end to end.',
]

/** The setup sentences, then numbered steps, until the budget is met. Always at least the first sentence, so the fix is never silent. */
function bodyFor(brief: ScriptBrief, args: { budget: number }): string {
  const setup = [
    `Here is the setup. ${brief.concept}.`,
    brief.signals.length > 0
      ? `People on ${brief.signals.map((signal) => hostOf(signal.url)).join(' and ')} were asking about this all week.`
      : '',
    `Step one, open the tool and find the place everyone gets stuck.`,
    `Step two, fix it the plain way. No plugins, no tricks.`,
  ].filter(Boolean)
  const sentences: string[] = []
  while (sentences.length === 0 || wordCount(sentences.join(' ')) < args.budget) {
    sentences.push(bodySentence(setup, sentences.length))
  }
  return sentences.join(' ')
}

function bodySentence(setup: string[], index: number): string {
  const sentence = setup[index]
  if (sentence !== undefined) return sentence
  const extra = index - setup.length
  const more = MORE_STEPS[extra % MORE_STEPS.length]
  if (!more) throw new Error('the mock writer ran out of steps')
  return `Step ${extra + 3}, ${more.charAt(0).toLowerCase()}${more.slice(1)}`
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
