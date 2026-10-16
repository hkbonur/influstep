import { describe, expect, it } from 'vitest'
import { CLIP_SECONDS, MEDIA_BUDGET, budgetProblem, generationPromptProblem, portraitPrompt, providerPrompt } from './media'

describe('generationPromptProblem', () => {
  it('lets a made-up picture through', () => {
    expect(generationPromptProblem('A run history where every execution fails in red', 'Formstep')).toBeNull()
    expect(generationPromptProblem('A tired founder at a desk covered in invoices', 'Formstep')).toBeNull()
  })

  it('lets the sponsor be named, and no other brand', () => {
    expect(generationPromptProblem('A Formstep request waiting for a signature', 'Formstep')).toBeNull()
    expect(generationPromptProblem('The n8n canvas with a red node', 'Formstep')).toMatch(/names n8n, a brand other than Formstep/)
    expect(generationPromptProblem('A Notion page full of tasks', 'Formstep')).toMatch(/names notion/)
  })

  it('never makes a screenshot or a real person', () => {
    expect(generationPromptProblem('A screenshot of an inbox with 400 unread emails', 'Formstep')).toMatch(/screenshot claims to be real/)
    expect(generationPromptProblem('A photo of Jane Doe at a conference', 'Formstep')).toMatch(/never shows a real person/)
    expect(generationPromptProblem('A celebrity holding a phone', 'Formstep')).toMatch(/real person/)
  })

  it('asks for words, and not too many', () => {
    expect(generationPromptProblem('  ', 'Formstep')).toBe('Say what the picture shows.')
    expect(generationPromptProblem('x'.repeat(401), 'Formstep')).toMatch(/within 400/)
  })
})

describe('budgetProblem', () => {
  it('fits until the day’s images or clip seconds would pass the budget', () => {
    expect(budgetProblem('image', { images: MEDIA_BUDGET.images - 1, clipSeconds: 0 })).toBeNull()
    expect(budgetProblem('image', { images: MEDIA_BUDGET.images, clipSeconds: 0 })).toMatch(/budget of 12 images is spent/)
    expect(budgetProblem('clip', { images: 0, clipSeconds: MEDIA_BUDGET.clipSeconds - CLIP_SECONDS })).toBeNull()
    expect(budgetProblem('clip', { images: 0, clipSeconds: MEDIA_BUDGET.clipSeconds - CLIP_SECONDS + 1 })).toMatch(
      /seconds of clips is spent/
    )
  })
})

describe('providerPrompt', () => {
  it('puts the prompt in the persona’s look and rules out words, logos and real people', () => {
    expect(providerPrompt('A red node.', { style: 'cartoon' })).toBe(
      'A red node. A bold, friendly cartoon illustration. No words, no logos, no real people.'
    )
    expect(providerPrompt('A red node', null)).toBe('A red node. A clean, flat illustration. No words, no logos, no real people.')
    expect(providerPrompt('A red node', { style: 'loom', face: 'photoreal' })).toBe(
      'A red node. A realistic photograph. No words, no logos, no real people.'
    )
  })
})

describe('portraitPrompt', () => {
  it('draws the face the look has, framed like a webcam for a Loom-style look', () => {
    expect(portraitPrompt('Short grey hair, round glasses.', { style: 'loom', face: 'cartoon' })).toBe(
      'A bold, friendly cartoon portrait framed like a webcam: a made-up presenter at a desk, head and shoulders, looking into the camera, soft home-office light. Short grey hair, round glasses. No words, no logos, not a real person.'
    )
    expect(portraitPrompt('Freckles', { style: 'photoreal' })).toMatch(/^A realistic photograph of a made-up presenter/)
    expect(() => portraitPrompt('x', { style: 'voice_only' })).toThrow('no presenter')
  })
})
