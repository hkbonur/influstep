import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import {
  ASSET_KIND_LABELS,
  CARD_TITLE_MAX,
  DELIVERY_LABELS,
  EPISODE_KIND_LABELS,
  EXPERIMENT_KIND_LABELS,
  POST_INTENT_BRIEFS,
  POST_INTENT_LABELS,
  PUBLICATION_TITLE_MAX,
  THREAD_PARTS_MAX,
  THREAD_PARTS_MIN,
  VOICE_TRAITS_MAX,
  SIGNAL_SOURCE_LABELS,
  WEEKDAYS,
  WORDS_PER_SECOND,
  chatIntentSchema,
  formatLength,
  type ChatIntent,
  type Habit,
} from '@influstep/shared'
import type { WriterMemory } from '../../core/memory'
import { requireEnv } from '../../lib/env'
import {
  POST_LENGTH_TARGETS,
  PRESENTER_TOOL,
  type AccountPostSample,
  type ChatTurn,
  type InterpretArgs,
  type LlmProvider,
  type PlanRow,
  type PostBrief,
  type PostDraft,
  type ScriptBrief,
  type ScriptDraft,
  type TaskReportArgs,
  type TaskSignal,
  type VoiceBrief,
  type VoiceDraft,
  type WriterResearch,
} from './types'

const MODEL = 'claude-opus-5-5'

const scriptDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  // The asset is a name from the brief's asset library, or empty when the beat shows none: structured outputs take no optional field.
  shotPlan: z.array(z.object({ title: z.string(), voiceover: z.string(), tool: z.string(), url: z.string(), asset: z.string() })),
})

// One shape for every kind keeps the structured output simple; the card title is empty unless the post is an image post.
const postDraftSchema = z.object({
  title: z.string(),
  parts: z.array(z.string()),
  cardTitle: z.string(),
})

// Structured outputs drop array bounds from the schema they send, so the trait count is said in the prompt and checked after parsing.
const voiceDraftSchema = z.object({
  language: z.string(),
  summary: z.string(),
  traits: z.array(z.string()),
})

function client(): Anthropic {
  return new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
}

function personaSystem(persona: ScriptBrief['persona']): string {
  return [
    `You are ${persona.name} (@${persona.handle}), a short-video creator in the niche "${persona.niche}".`,
    `Tone: ${persona.tone}.`,
    `Content pillars: ${persona.pillars.join('; ')}.`,
    `Persona bible:\n${persona.bible}`,
  ].join('\n')
}

export const anthropicLlm: LlmProvider = {
  name: 'anthropic',
  async writeScript(brief: ScriptBrief): Promise<ScriptDraft> {
    const response = await client().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: zodOutputFormat(scriptDraftSchema) },
      system: [{ type: 'text', text: personaSystem(brief.persona), cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            lengthInstruction(brief),
            BEATS_INSTRUCTION,
            deliveryInstruction(brief),
            `Concept: ${brief.concept}`,
            `Pillar: ${brief.pillar}`,
            memoryInstruction(brief.memory),
            assetsInstruction(brief),
            defaultsInstruction(brief),
            variantInstruction(brief),
            sponsorInstruction(brief),
            brief.directives.length > 0 ? `Standing directives from the operator:\n- ${brief.directives.join('\n- ')}` : '',
            brief.signals.length > 0
              ? `What the audience is talking about:\n${brief.signals.map((signal) => `- ${signalLine(signal)}`).join('\n')}`
              : '',
            movedInstruction(brief.research),
            problemsInstruction(brief.research),
            `Hook conventions of the platforms this goes to, all of which the hook (the first sentence of the first beat) must satisfy:\n- ${brief.format.hookNotes.join('\n- ')}`,
            brief.problems.length > 0 ? `Your last draft broke these rules. Fix every one:\n- ${brief.problems.join('\n- ')}` : '',
            `Return a title of at most ${PUBLICATION_TITLE_MAX} characters, the description, and the beats in order. The description is one to three sentences in your own voice about what the video shows, for the description box under it. Leave out links, discount codes, the AI disclosure, the sponsor line and hashtags: what each platform needs is added when it goes out.`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new Error('The model declined to write this script')
    if (!response.parsed_output) throw new Error('The model returned no parseable script')
    const { shotPlan, ...draft } = response.parsed_output
    return { ...draft, shotPlan: shotPlan.map(({ asset, ...beat }) => (asset.trim() === '' ? beat : { ...beat, asset })) }
  },
  async writePost(brief: PostBrief): Promise<PostDraft> {
    const response = await client().messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: 'medium', format: zodOutputFormat(postDraftSchema) },
      system: [{ type: 'text', text: postSystem(brief.persona), cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            brief.intent ? `Intent: ${POST_INTENT_LABELS[brief.intent]}. ${POST_INTENT_BRIEFS[brief.intent]}` : '',
            postShapeInstruction(brief),
            voiceInstruction(brief),
            examplesInstruction(brief.examples),
            `Persona bible:\n${brief.persona.bible}`,
            memoryInstruction(brief.memory),
            brief.directives.length > 0 ? `Standing directives from the operator:\n- ${brief.directives.join('\n- ')}` : '',
            `Concept: ${brief.concept}`,
            `Pillar: ${brief.pillar}`,
            postSponsorInstruction(brief),
            brief.signals.length > 0
              ? `What the audience is talking about:\n${brief.signals.map((signal) => `- ${signalLine(signal)}`).join('\n')}`
              : '',
            movedInstruction(brief.research),
            problemsInstruction(brief.research),
            `The first line of the first part is the hook. Your convention on X: ${brief.hookNote}`,
            `Every part is at most ${brief.partLimit} characters, and X counts every link as 23. X gets the parts exactly as you write them; nothing is added. End on the post's own last point: no sign-off, no call to follow, no link.`,
            brief.problems.length > 0 ? `Your last draft broke these rules. Fix every one:\n- ${brief.problems.join('\n- ')}` : '',
            `Return a short title for the operator's calendar, in English, the parts in order, and ${brief.kind === 'image' ? 'the card title, in the language of the post' : 'an empty card title'}.`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new Error('The model declined to write this post')
    if (!response.parsed_output) throw new Error('The model returned no parseable post')
    const { title, parts, cardTitle } = response.parsed_output
    if (brief.kind === 'image') return { title, post: { parts, cardTitle } }
    return { title, post: { parts } }
  },
  async learnVoice(brief: VoiceBrief): Promise<VoiceDraft> {
    const { stats } = brief
    const response = await client().messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: 'medium', format: zodOutputFormat(voiceDraftSchema) },
      system: [
        {
          type: 'text',
          text: [
            `You are the analyst for ${brief.persona.name} (@${brief.persona.handle}), an account on X in the niche "${brief.persona.niche}".`,
            "Read the account's own posts and describe how it writes, so a writer can post in the same voice. Describe the style, not the topics.",
          ].join('\n'),
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            `Counted from ${stats.sampleSize} original posts (replies to others left out): ${Math.round(stats.lengthMix.short * 100)}% one-liners, ${Math.round(stats.lengthMix.medium * 100)}% full posts, ${Math.round(stats.lengthMix.long * 100)}% threads; emoji ${stats.emoji}; hashtags ${stats.hashtags}. These are facts; do not restate them as traits.`,
            `The posts with the most likes and reposts:\n${samplesBlock(brief.top)}`,
            brief.newest.length > 0 ? `The newest posts:\n${samplesBlock(brief.newest)}` : '',
            [
              'Return:',
              '- language: the BCP 47 tag of the language the account posts in (en, nb, tr, ...), the one most of its posts are written in.',
              '- summary: two or three sentences on how the account sounds, written for the writer who will imitate it.',
              `- traits: 1 to ${VOICE_TRAITS_MAX} recurring moves, each a short phrase (how it opens, line breaks, lists, punctuation, questions, how it closes).`,
            ].join('\n'),
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new Error('The model declined to describe this voice')
    if (!response.parsed_output) throw new Error('The model returned no parseable voice')
    const { language, summary } = response.parsed_output
    const traits = response.parsed_output.traits.map((trait) => trait.trim()).filter((trait) => trait.length > 0)
    if (language.trim().length === 0) throw new Error('The model returned a voice without a language')
    if (summary.trim().length === 0) throw new Error('The model returned a voice without a summary')
    if (traits.length === 0 || traits.length > VOICE_TRAITS_MAX)
      throw new Error(`The model returned ${traits.length} traits; a voice has 1 to ${VOICE_TRAITS_MAX}`)
    return { language: language.trim(), summary: summary.trim(), traits }
  },
  async reply(args) {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: personaSystem(args.persona), cache_control: { type: 'ephemeral' } },
        {
          type: 'text',
          text: `You are chatting with your operator inside Influstep. Answer in two or three sentences. ${args.directive ? `The operator's last message was stored as a standing directive: "${args.directive}". Confirm it and say how the next episodes change.` : ''}`,
        },
      ],
      messages: args.history.map((turn) => ({ role: turn.author === 'operator' ? 'user' : 'assistant', content: turn.text })),
    })
    const text = response.content.find((block) => block.type === 'text')
    if (!text) throw new Error('The model returned no text')
    return text.text
  },
  async interpret(args) {
    let response
    try {
      response = await client().messages.parse({
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: 'low', format: zodOutputFormat(chatIntentSchema) },
        system: [{ type: 'text', text: INTERPRET_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: interpretRequest(args) }],
      })
    } catch (error) {
      // The SDK checks the answer against the schema itself and throws a plain AnthropicError when it does not fit
      // (a code with a dash, say). A reading that does not fit changes nothing, so it is conversation; a failed
      // request (an APIError) stays an error, and the chat says it could not read the message.
      if (error instanceof Anthropic.APIError || !(error instanceof Anthropic.AnthropicError)) throw error
      console.warn(`The interpreter's answer did not fit the chat intent schema; it is read as conversation. ${error.message}`)
      return CONVERSATION
    }
    if (response.stop_reason === 'refusal') throw new Error('The model declined to read this message')
    if (!response.parsed_output) throw new Error('The model returned no parseable reading of the message')
    return response.parsed_output
  },
  async taskReport(args) {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: personaSystem(args.persona), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: TASK_REPORT_INSTRUCTION },
      ],
      messages: [{ role: 'user', content: taskRequest(args) }],
    })
    if (response.stop_reason === 'refusal') throw new Error('The model declined to write this report')
    const text = response.content.find((block) => block.type === 'text')
    if (!text) throw new Error('The model returned no text')
    return text.text
  },
}

const CONVERSATION: ChatIntent = { kind: 'conversation' }

/** What the interpreter does, for every message alike, so it caches; the persona, the plan and the message follow. */
const INTERPRET_SYSTEM = [
  'You read a message the operator of Influstep sends to one of its personas, an AI creator, and say what the message asks for. You never answer the message.',
  'Kinds:',
  '- conversation: a question, a remark, thanks, or anything you are unsure about. When in doubt, it is conversation.',
  '- directive: a standing rule for the next scripts and posts ("focus on beginners", "stop saying guys"). text is the rule in the operator\'s words.',
  "- replace: replace one planned episode with a new one. concept is the new episode's idea in a short phrase.",
  '- move: move one planned episode to another day of its week. to is that weekday.',
  '- drop: drop one planned episode.',
  '- task: a report one agent writes. research_brief is research on a subject; comment_digest is what people say in the comments; analytics_summary is how the persona is doing in numbers. topic only when the message names a subject.',
  '- remember: something the operator wants the persona to keep knowing ("remember that viewers hate the word guys", "keep in mind most viewers self-host"). memory is rule when it says what to always or never do, else fact; text is what to remember in the operator\'s words, without "remember that". A standing instruction for the next scripts without "remember" is a directive.',
  '- give_code: a discount code for the descriptions. code is the code as written; offer is what it gives ("20% off Pro for 3 months"), or null when the message does not say; target only when the message ties the code to an episode.',
  `Targets: when the message names an episode of the plan, set target.episodeId to that row's id and nothing else. "The next video" is next: true. When nothing in the plan fits, give the weekday and a keyword as the message says them, so the persona can say it found no such episode. Weekdays are ${WEEKDAYS.join(', ')}.`,
  'Read the earlier chat for what a short follow-up refers to ("the second one", "yes, that one").',
].join('\n')

function interpretRequest(args: InterpretArgs): string {
  return [
    `Persona: ${args.persona.name} (@${args.persona.handle}), niche "${args.persona.niche}", pillars: ${args.persona.pillars.join('; ')}.`,
    args.plan.length > 0
      ? `The plan, the only episodes a message can change:\n${args.plan.map(planLine).join('\n')}`
      : 'The plan is empty: no episode can be changed now.',
    args.history.length > 0 ? `The chat so far:\n${args.history.map((turn) => turnLine(args.persona.name, turn)).join('\n')}` : '',
    `The message to read:\n<message>\n${args.text}\n</message>`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function planLine(row: PlanRow): string {
  const pillar = row.pillar === null ? '' : `, pillar "${row.pillar}"`
  return `- id ${row.id}: ${row.weekday} ${row.plannedFor}, ${EPISODE_KIND_LABELS[row.kind]}, "${row.title}"${pillar}, ${row.status}`
}

function turnLine(personaName: string, turn: ChatTurn): string {
  return `${turn.author === 'operator' ? 'Operator' : personaName}: ${turn.text}`
}

const TASK_REPORT_INSTRUCTION = [
  'You are answering your operator in the Influstep chat with a report one of your agents put together.',
  'Write plain text in your own voice, under 120 words, with no headings.',
  'Use only numbers that appear in the data; never estimate, total or invent one. When the data is empty, say so plainly.',
].join(' ')

function taskRequest(args: TaskReportArgs): string {
  if (args.task === 'research_brief') {
    const on = args.topic === null ? '' : ` on "${args.topic}"`
    if (args.data.signals.length === 0) return `The operator asked for a research brief${on}. There are no new signals${on}.`
    return `The operator asked for a research brief${on}. Say what people are asking about and which of it would make a good episode. The ${args.data.signals.length} freshest unused signals:\n${signalsBlock(args.data.signals)}`
  }
  if (args.task === 'comment_digest') {
    const window = `in the last ${args.data.days} days`
    if (args.data.total === 0) return `The operator asked what people say in the comments. There are no comments ${window}.`
    return `The operator asked what people say in the comments. Say what they praise, ask and complain about. ${args.data.total} comments ${window}; the ${args.data.comments.length} most liked:\n${signalsBlock(args.data.comments)}`
  }
  const { funnel, days, currency } = args.data
  return [
    `The operator asked how the last ${days} days went. Say what stands out.`,
    `Views ${funnel.views}, follows ${funnel.follows}, link clicks ${funnel.clicks}, demos started ${funnel.demos}, signups ${funnel.signups}, trials ${funnel.trials}, paid ${funnel.paid} (${funnel.paidViaCode} through a discount code), value ${funnel.value} ${currency}.`,
    'Views and follows are the latest platform counts taken in the window. Conversions are first-touch and undercount; say so if you mention them.',
    funnel.mock ? 'Some of these numbers are mock data; say so.' : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function signalsBlock(signals: TaskSignal[]): string {
  return signals.map((signal) => `- [${SIGNAL_SOURCE_LABELS[signal.source]}] ${signalLine(signal)}`).join('\n')
}

/**
 * A signal as the model reads it: its title, its summary, and its link in
 * brackets. A problem from the problem log, or a comment under a publication
 * with no URL yet, links nowhere, so it gets no brackets: an empty pair would
 * read as a source with no destination.
 */
function signalLine(signal: { title: string; summary: string; url: string }): string {
  if (signal.url === '') return `${signal.title}: ${signal.summary}`
  return `${signal.title}: ${signal.summary} (${signal.url})`
}

function lengthInstruction(brief: ScriptBrief): string {
  const { lengthSec, delivery } = brief.format
  const words = Math.round(lengthSec * WORDS_PER_SECOND)
  return `Write a script of about ${formatLength(lengthSec)} (${lengthSec} seconds) for a video delivered as "${DELIVERY_LABELS[delivery]}". At ${WORDS_PER_SECOND} words per second that is about ${words} spoken words across all the beats together.`
}

/** The beats are the only script: the voice track is built from them word for word. */
const BEATS_INSTRUCTION = [
  'The script is a list of beats, and nothing else is spoken. Each beat has a short title and a voiceover: exactly the words said while that beat is on screen, with no stage directions, labels or notes.',
  'The first sentence of the first beat is the hook. The call to action closes the last beat.',
].join(' ')

function deliveryInstruction(brief: ScriptBrief): string {
  if (brief.format.delivery === 'talking_head') {
    const demo = brief.sponsorSegment === 'demo' ? ', except the sponsor demo beat described below' : ''
    return `Delivery is talking head: the presenter speaks every beat to camera and no screen is recorded. Every beat has tool "${PRESENTER_TOOL}" and an empty url${demo}.`
  }
  if (brief.format.delivery === 'screen_only')
    return `Delivery is screen only: two to four beats, each showing a screen, and every beat names the tool on screen and the URL to open.`
  return `Delivery is screen with avatar: the first beat is the presenter speaking to camera (tool "${PRESENTER_TOOL}", empty url) and it opens with the hook; the beats after it are the screens to record, each naming the tool on screen and the URL to open.`
}

/**
 * The researcher's morning brief, in its own words: background for the
 * concept, never a reason to change it. Nothing before the first sweep or
 * once the brief expired.
 */
function movedInstruction(research: WriterResearch): string {
  if (research.brief === null) return ''
  return `What moved since yesterday (this morning's research brief; background for the concept, never a reason to swap it):\n${research.brief}`
}

/** The persona's open problems, newest first: questions viewers keep asking and tools that broke on camera. Nothing while the log is empty. */
function problemsInstruction(research: WriterResearch): string {
  if (research.problems.length === 0) return ''
  return `Problems I met (your own problem log, newest first; answer one only where it fits the concept):\n- ${research.problems.join('\n- ')}`
}

/**
 * The persona's memory (core/memory.ts `writerMemory`): the goal and where it
 * stands, the operator's rules, which the draft never breaks, the facts it
 * knows, and what its own experiments and reviews showed. Each part is left
 * out while it is empty.
 */
function memoryInstruction(memory: WriterMemory): string {
  return [
    `The goal you work toward: ${memory.goal}.${memory.standing === null ? '' : ` Where you stand: ${memory.standing}`}`,
    memory.rules.length > 0 ? `Rules you keep, from your memory; never break one:\n- ${memory.rules.join('\n- ')}` : '',
    memory.facts.length > 0 ? `What you know about your audience and your niche:\n- ${memory.facts.join('\n- ')}` : '',
    memory.learnings.length > 0
      ? `What you have learned from your own experiments and reviews, newest first:\n- ${memory.learnings.join('\n- ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * The images and clips of the persona's asset library (core/assets.ts
 * `writerAssets`). A beat that should show one names it in its asset field,
 * and the producer shows it in place of the beat's screen or the presenter.
 */
function assetsInstruction(brief: ScriptBrief): string {
  const none = "Leave every beat's asset empty."
  if (brief.assets.length === 0) return `Your asset library holds no images or clips. ${none}`
  const lines = brief.assets.map((asset) => {
    const tags = asset.tags.length === 0 ? '' : ` (${asset.tags.join(', ')})`
    const note = asset.note === '' ? '' : `: ${asset.note}`
    return `- "${asset.name}", ${ASSET_KIND_LABELS[asset.kind].toLowerCase()}${tags}${note}`
  })
  return [
    `Your asset library, which a beat can show in place of its screen or you on camera:\n${lines.join('\n')}`,
    `Where a beat is better told by one of these, put its exact name in that beat's asset; an image is held and a clip is looped for the beat. Never put one on the ${brief.sponsorName} demo beat. Leave the asset empty on every other beat.`,
  ].join('\n')
}

/** The dimensions where the persona no longer does what it did at the start (shared `styleLines`); nothing while every one is the control. */
function defaultsInstruction(brief: ScriptBrief): string {
  if (brief.styleLines.length === 0) return ''
  return `Your defaults, which this script follows:\n- ${brief.styleLines.join('\n- ')}`
}

/**
 * The experiment variant the episode carries. It comes after the memory
 * and the defaults and wins over them for its dimension, so the experiment
 * measures what it set out to measure.
 */
function variantInstruction(brief: ScriptBrief): string {
  if (!brief.variant) return ''
  const dimension = EXPERIMENT_KIND_LABELS[brief.variant.kind].toLowerCase()
  return [
    `This episode is the "${brief.variant.key}" variant of an experiment on ${dimension}: ${brief.variant.description}`,
    `Follow it for ${dimension}, even where a default or a learning above says otherwise.`,
  ].join('\n')
}

function sponsorInstruction(brief: ScriptBrief): string {
  if (brief.sponsorSegment === 'none') return `No sponsor in this episode: never name ${brief.sponsorName} in any beat.`
  if (brief.sponsorSegment === 'mention')
    return `Sponsor mention: one sentence inside a beat names ${brief.sponsorName} (forms that workflows and AI agents send to one customer; the answers come back into the flow) and says the video is sponsored by it. The mention gets no beat of its own.`
  const spoken = brief.format.delivery === 'talking_head' ? ' The presenter speaks it to camera; nothing is recorded.' : ''
  return `Sponsor demo: ${brief.sponsorName} gets a beat of its own with tool "${brief.sponsorName}" and url "${brief.sponsorUrl}".${spoken} Its voiceover shows how a workflow creates a request, the customer fills a prefilled form, and the answers return to the flow, and says the video is sponsored by ${brief.sponsorName}.`
}

/** Who writes a post. The bible, the voice and the examples follow in the request, in that order of weight. */
function postSystem(persona: PostBrief['persona']): string {
  return [
    `You are ${persona.name} (@${persona.handle}), who posts on X in the niche "${persona.niche}".`,
    `Content pillars: ${persona.pillars.join('; ')}.`,
  ].join('\n')
}

/** The kind and, when the planner set one, the length the post must have. */
function postShapeInstruction(brief: PostBrief): string {
  const length = brief.length ? ` Length: ${POST_LENGTH_TARGETS[brief.length]}.` : ''
  if (brief.kind === 'text') return `Write one text post for X: a single part, no media.${length}`
  if (brief.kind === 'image')
    return `Write one image post for X: a single part, and a card title of at most ${CARD_TITLE_MAX} characters that the producer renders as a 16:9 title card attached to the post.${length}`
  return `Write a thread for X of ${THREAD_PARTS_MIN} to ${THREAD_PARTS_MAX} parts. Each part reads on its own, and the first one makes the reader open the thread.`
}

/** With a learned voice, the account's language and style; without one, English in the persona's tone, as before a takeover. */
function voiceInstruction(brief: PostBrief): string {
  const voice = brief.voice
  if (!voice) return `Write in English. Tone: ${brief.persona.tone}.`
  return [
    `Write in the language with the BCP 47 tag "${voice.language}", in this account's voice: ${voice.summary}`,
    `Its recurring moves:\n- ${voice.traits.join('\n- ')}`,
    `Emoji: ${HABIT_WORDS[voice.emoji]}. Hashtags: ${HABIT_WORDS[voice.hashtags]}.`,
  ].join('\n')
}

const HABIT_WORDS: Record<Habit, string> = {
  never: 'never',
  rare: 'rarely, at most one',
  often: 'often',
}

function examplesInstruction(examples: string[][]): string {
  if (examples.length === 0) return ''
  const posts = examples.map((parts) => `<post>\n${parts.join('\n---\n')}\n</post>`).join('\n')
  return `Posts this account wrote itself. Imitate their style (rhythm, line breaks, length, punctuation); never copy their words or claims. A thread's parts are separated by ---.\n${posts}`
}

/** The account's posts verbatim, with their engagement, a thread's parts separated by ---. */
function samplesBlock(samples: AccountPostSample[]): string {
  return samples
    .map((sample) => `<post likes="${sample.likes}" reposts="${sample.reposts}">\n${sample.parts.join('\n---\n')}\n</post>`)
    .join('\n')
}

/**
 * A post shows no screen, so a demo segment on a post is written as a
 * mention. X's automated account label is the disclosure there, so the
 * mention carries no link and no code.
 */
function postSponsorInstruction(brief: PostBrief): string {
  if (brief.sponsorSegment === 'none') return `Leave ${brief.sponsorName} out of the text.`
  return `Mention ${brief.sponsorName} in one sentence, in your own words (forms that workflows and AI agents send to one customer, answers come back into the flow). No link and no discount code.`
}
