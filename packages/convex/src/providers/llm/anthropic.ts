import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import {
  CARD_TITLE_MAX,
  DELIVERY_LABELS,
  POST_INTENT_BRIEFS,
  POST_INTENT_LABELS,
  PUBLICATION_TITLE_MAX,
  THREAD_PARTS_MAX,
  THREAD_PARTS_MIN,
  VOICE_TRAITS_MAX,
  WORDS_PER_SECOND,
  formatLength,
  type Habit,
} from '@influstep/shared'
import { requireEnv } from '../../lib/env'
import {
  POST_LENGTH_TARGETS,
  PRESENTER_TOOL,
  type AccountPostSample,
  type LlmProvider,
  type PostBrief,
  type PostDraft,
  type ScriptBrief,
  type ScriptDraft,
  type VoiceBrief,
  type VoiceDraft,
} from './types'

const MODEL = 'claude-opus-5-5'

const scriptDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  shotPlan: z.array(z.object({ title: z.string(), voiceover: z.string(), tool: z.string(), url: z.string() })),
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
            brief.variant ? `This episode is the "${brief.variant.key}" variant of an experiment: ${brief.variant.description}` : '',
            sponsorInstruction(brief),
            brief.directives.length > 0 ? `Standing directives from the operator:\n- ${brief.directives.join('\n- ')}` : '',
            brief.signals.length > 0
              ? `What the audience is talking about:\n${brief.signals.map((signal) => `- ${signal.title}: ${signal.summary} (${signal.url})`).join('\n')}`
              : '',
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
    return response.parsed_output
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
            brief.directives.length > 0 ? `Standing directives from the operator:\n- ${brief.directives.join('\n- ')}` : '',
            `Concept: ${brief.concept}`,
            `Pillar: ${brief.pillar}`,
            postSponsorInstruction(brief),
            brief.signals.length > 0
              ? `What the audience is talking about:\n${brief.signals.map((signal) => `- ${signal.title}: ${signal.summary} (${signal.url})`).join('\n')}`
              : '',
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
