import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { DELIVERY_LABELS, formatLength } from '@influstep/shared'
import { requireEnv } from '../../lib/env'
import { PRESENTER_TOOL, WORDS_PER_SECOND, type LlmProvider, type ScriptBrief, type ScriptDraft } from './types'

const MODEL = 'claude-opus-5-5'

const scriptDraftSchema = z.object({
  title: z.string(),
  hook: z.string(),
  script: z.object({ hook: z.string(), body: z.string(), sponsor: z.string(), cta: z.string() }),
  shotPlan: z.array(z.object({ title: z.string(), voiceover: z.string(), tool: z.string(), url: z.string() })),
  topics: z.array(z.string()),
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
            `Concept: ${brief.concept}`,
            `Pillar: ${brief.pillar}`,
            brief.variant ? `This episode is the "${brief.variant.key}" variant of an experiment: ${brief.variant.description}` : '',
            sponsorInstruction(brief),
            brief.directives.length > 0 ? `Standing directives from the operator:\n- ${brief.directives.join('\n- ')}` : '',
            brief.signals.length > 0
              ? `What the audience is talking about:\n${brief.signals.map((signal) => `- ${signal.title}: ${signal.summary} (${signal.url})`).join('\n')}`
              : '',
            `Hook conventions of the platforms this goes to, all of which the hook must satisfy:\n- ${brief.format.hookNotes.join('\n- ')}`,
            `Return the hook as its own field and again as script.hook. ${deliveryInstruction(brief)}`,
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
  return `Write a spoken script of about ${formatLength(lengthSec)} (${lengthSec} seconds) for a video delivered as "${DELIVERY_LABELS[delivery]}". At ${WORDS_PER_SECOND} words per second that is a budget of about ${words} words across hook, body, sponsor and call to action.`
}

function deliveryInstruction(brief: ScriptBrief): string {
  if (brief.format.delivery === 'talking_head')
    return `Delivery is talking head: the presenter speaks to camera and no screen is recorded. The shot plan is a list of beats, each with tool "${PRESENTER_TOOL}" and an empty url.`
  if (brief.format.delivery === 'screen_only')
    return `Delivery is screen only: the shot plan lists the screens to record, two to four shots, and every beat names the tool on screen and the URL to open.`
  return `Delivery is screen with avatar: the first beat of the shot plan is the presenter speaking the hook (tool "${PRESENTER_TOOL}", empty url); the beats after it are the screens to record, each naming the tool on screen and the URL to open.`
}

function sponsorInstruction(brief: ScriptBrief): string {
  if (brief.sponsorSegment === 'none') return `No sponsor in this episode. Leave script.sponsor empty.`
  if (brief.sponsorSegment === 'mention')
    return `Include a one-sentence sponsor mention for ${brief.sponsorName} (forms that workflows and AI agents send to one customer, answers come back into the flow) in script.sponsor. Say it is sponsored.`
  return `Include a sponsor demo of ${brief.sponsorName} in script.sponsor: show how a workflow creates a request, the customer fills a prefilled form, and the answers return to the flow. Add a shot for it. Say it is sponsored.`
}
