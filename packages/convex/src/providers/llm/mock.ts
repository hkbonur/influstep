import { PRESENTER_TOOL, WORDS_PER_SECOND, type LlmProvider, type ScriptBrief, type ScriptDraft } from './types'

/**
 * A template writer. Deterministic from the brief, so a seeded demo and a
 * test read the same script twice. It is honest about being a mock: every
 * script opens with the concept and names the variant it follows. The body
 * grows with the format's length and the shot plan follows its delivery.
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
      title: titleFor(brief, topic),
      hook,
      script: { hook, body, sponsor, cta },
      shotPlan: shotPlanFor(brief, { hook, body, sponsor }),
      topics: [brief.pillar, ...topic.toLowerCase().split(/\s+/).slice(0, 2)],
    }
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

function titleFor(brief: ScriptBrief, topic: string): string {
  return `${topic} (${brief.pillar})`.slice(0, 90)
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
