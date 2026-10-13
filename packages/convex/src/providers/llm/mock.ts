import {
  CARD_TITLE_MAX,
  POST_LENGTHS,
  SHORT_POST_MAX,
  xLength,
  type Habit,
  type LengthMix,
  type PostIntent,
  type PostLength,
} from '@influstep/shared'
import {
  PRESENTER_TOOL,
  WORDS_PER_SECOND,
  type AccountPostSample,
  type LlmProvider,
  type PostBrief,
  type PostDraft,
  type ScriptBrief,
  type ScriptDraft,
  type VoiceBrief,
  type VoiceDraft,
} from './types'

/**
 * A template writer. Deterministic from the brief, so a seeded demo and a
 * test read the same script twice. It is honest about being a mock: every
 * script opens with the concept and names the variant it follows. The body
 * grows with the format's length and the shot plan follows its delivery.
 * A post opens with its topic too, follows its intent and length, and every
 * part is cut to the limit the brief gives it, so a mock post always passes
 * X's rules. A voice in Norwegian or Turkish puts a short native phrase in
 * front, so a smoke test shows the language reached the writer. A learned
 * voice is the counted stats in words, in the persona's tone.
 */
export const mockLlm: LlmProvider = {
  name: 'mock',
  async writeScript(brief: ScriptBrief): Promise<ScriptDraft> {
    const topic = brief.signals[0]?.title ?? brief.concept
    const hook = hookFor(brief, topic)
    const sponsor = sponsorFor(brief)
    const cta =
      brief.sponsorSegment === 'none'
        ? `Follow ${brief.persona.name} for more ${brief.pillar.toLowerCase()}.`
        : `Link to ${brief.sponsorName} in the description. Follow for the next one.`
    const body = bodyFor(brief, {
      budget: Math.round(brief.format.lengthSec * WORDS_PER_SECOND) - wordCount([hook, sponsor, cta].join(' ')),
    })
    return {
      title: titleFor(brief.pillar, topic),
      hook,
      script: { hook, body, sponsor, cta },
      shotPlan: shotPlanFor(brief, { hook, body, sponsor }),
      topics: [brief.pillar, ...topic.toLowerCase().split(/\s+/).slice(0, 2)],
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
    return `Got it. I will keep that in mind for the next episode. Say "focus on ..." or "stop ..." to turn it into a directive.`
  },
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
  const closing = [sponsorLine, `Follow ${brief.persona.name} for more ${brief.pillar.toLowerCase()}.`].filter(Boolean).join(' ')
  return [lead(`${args.topic}: ${opener}`), ...rest, `${last} ${closing}`].map((part) => fit(part, brief.partLimit))
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

function hookFor(brief: ScriptBrief, topic: string): string {
  const key = brief.variant?.key ?? 'control'
  if (key.includes('wrong')) return `I was wrong about ${topic.toLowerCase()}.`
  if (key.includes('question')) return `Why does ${topic.toLowerCase()} break for everyone?`
  return `How to ${topic.toLowerCase()} in under a minute.`
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

function sponsorFor(brief: ScriptBrief): string {
  if (brief.sponsorSegment === 'none') return ''
  if (brief.sponsorSegment === 'mention')
    return `This one is sponsored by ${brief.sponsorName}: forms your workflows and AI agents send to one customer and get back as answers.`
  return `And when the workflow needs something from a customer, I use ${brief.sponsorName}. Create a request, the customer gets a prefilled form, the answers come straight back into the flow. Here it is.`
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

/** The setup sentences first, then numbered steps until the budget is met. Never shorter than the setup. */
function bodyFor(brief: ScriptBrief, args: { budget: number }): string {
  const sentences = [
    `Here is the setup. ${brief.concept}.`,
    brief.signals.length > 0
      ? `People on ${brief.signals.map((signal) => hostOf(signal.url)).join(' and ')} were asking about this all week.`
      : '',
    `Step one, open the tool and find the place everyone gets stuck.`,
    `Step two, fix it the plain way. No plugins, no tricks.`,
  ].filter(Boolean)
  let step = 3
  while (wordCount(sentences.join(' ')) < args.budget) {
    const more = MORE_STEPS[(step - 3) % MORE_STEPS.length]
    if (!more) throw new Error('the mock writer ran out of steps')
    sentences.push(`Step ${step}, ${more.charAt(0).toLowerCase()}${more.slice(1)}`)
    step += 1
  }
  if (brief.directives.length > 0) sentences.push(`(Writer note: following the directive "${brief.directives[0]}".)`)
  return sentences.join(' ')
}

/** Talking head: the presenter speaks every beat. Otherwise the screens as always, the sponsor demo as its own screen. */
function shotPlanFor(brief: ScriptBrief, script: { hook: string; body: string; sponsor: string }): ScriptDraft['shotPlan'] {
  if (brief.format.delivery === 'talking_head') {
    return [
      { title: 'The hook', voiceover: script.hook, tool: PRESENTER_TOOL, url: '' },
      { title: 'The fix', voiceover: script.body, tool: PRESENTER_TOOL, url: '' },
      ...(brief.sponsorSegment === 'demo'
        ? [{ title: `${brief.sponsorName} demo`, voiceover: script.sponsor, tool: PRESENTER_TOOL, url: '' }]
        : []),
    ]
  }
  return [
    { title: 'The problem', voiceover: script.hook, tool: 'browser', url: 'https://news.ycombinator.com' },
    { title: 'The fix', voiceover: script.body, tool: 'n8n', url: 'http://localhost:5678' },
    ...(brief.sponsorSegment === 'demo'
      ? [{ title: `${brief.sponsorName} demo`, voiceover: script.sponsor, tool: brief.sponsorName, url: 'https://formstep.io' }]
      : []),
  ]
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
