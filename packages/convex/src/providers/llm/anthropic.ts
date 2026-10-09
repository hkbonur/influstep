import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { requireEnv } from '../../lib/env'
import type { LlmProvider, ScriptBrief, ScriptDraft } from './types'

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
            `Write a 45 to 75 second spoken script for a short video on ${brief.platforms.join(', ')}.`,
            `Concept: ${brief.concept}`,
            `Pillar: ${brief.pillar}`,
            brief.variant ? `This episode is the "${brief.variant.key}" variant of an experiment: ${brief.variant.description}` : '',
            sponsorInstruction(brief),
            brief.directives.length > 0 ? `Standing directives from the operator:\n- ${brief.directives.join('\n- ')}` : '',
            brief.signals.length > 0
              ? `What the audience is talking about:\n${brief.signals.map((signal) => `- ${signal.title}: ${signal.summary} (${signal.url})`).join('\n')}`
              : '',
            `Return the hook as its own field and again as script.hook. The shot plan lists the screens to record: a tool name and the URL to open, two to four shots.`,
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

function sponsorInstruction(brief: ScriptBrief): string {
  if (brief.sponsorSegment === 'none') return `No sponsor in this episode. Leave script.sponsor empty.`
  if (brief.sponsorSegment === 'mention')
    return `Include a one-sentence sponsor mention for ${brief.sponsorName} (forms that workflows and AI agents send to one customer, answers come back into the flow) in script.sponsor. Say it is sponsored.`
  return `Include a sponsor demo of ${brief.sponsorName} in script.sponsor: show how a workflow creates a request, the customer fills a prefilled form, and the answers return to the flow. Add a shot for it. Say it is sponsored.`
}
