import { CARD_TITLE_MAX, xLength } from '@influstep/shared'
import {
  PRESENTER_TOOL,
  WORDS_PER_SECOND,
  type LlmProvider,
  type PostBrief,
  type PostDraft,
  type ScriptBrief,
  type ScriptDraft,
} from './types'

/**
 * A template writer. Deterministic from the brief, so a seeded demo and a
 * test read the same script twice. It is honest about being a mock: every
 * script opens with the concept and names the variant it follows. The body
 * grows with the format's length and the shot plan follows its delivery.
 * A post opens with its topic too, and every part is cut to the limit the
 * brief gives it, so a mock post always passes X's rules.
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
    const hook = `${topic}: the short version.`
    const sponsor = brief.sponsorSegment === 'none' ? '' : `I collect what a flow needs from a customer with ${brief.sponsorName}.`
    if (brief.kind === 'thread') {
      const last = [
        `3. Keep the fix small enough to undo.`,
        sponsor,
        `Follow ${brief.persona.name} for more ${brief.pillar.toLowerCase()}.`,
      ]
      const parts = [
        fit(`${hook}\nThree steps, in order.`, brief.partLimit),
        fit('1. Run it once and watch where it stops. Read the log before you touch the config.', brief.partLimit),
        fit('2. Fix it the plain way, no plugins. Then test the failure path, not just the one that works.', brief.partLimit),
        fit(last.filter(Boolean).join(' '), brief.partLimit),
      ]
      return { title, post: { parts } }
    }
    const part = fit(
      [hook, sponsor, 'Run it once, read the log, and fix the one step that stops.'].filter(Boolean).join('\n'),
      brief.partLimit
    )
    if (brief.kind === 'image') return { title, post: { parts: [part], cardTitle: fit(topic, CARD_TITLE_MAX) } }
    return { title, post: { parts: [part] } }
  },
  async reply(args) {
    const last = args.history.at(-1)
    if (args.directive) return `Noted. From now on: "${args.directive}". The next scripts follow it.`
    if (!last) return `Hi, I am ${args.persona.name}. Tell me what to focus on, or ask what is planned.`
    return `Got it. I will keep that in mind for the next episode. Say "focus on ..." or "stop ..." to turn it into a directive.`
  },
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
