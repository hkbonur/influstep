import { describe, expect, it } from 'vitest'
import { firstSentence, hookOf, lengthProblem, scriptProblems, spokenScript, spokenSeconds, spokenWordCount, type Beat } from './beats'

const SPONSOR = 'Formstep'

const beat = (voiceover: string, tool = 'n8n', title = 'A beat'): Beat => ({ title, voiceover, tool, url: 'http://localhost:5678' })

describe('spokenScript', () => {
  it('reads the voiceovers in order, a blank line between beats', () => {
    expect(spokenScript([beat('Your webhook failed.'), beat('Add an error workflow.')])).toBe(
      'Your webhook failed.\n\nAdd an error workflow.'
    )
  })
  it('is empty without beats', () => {
    expect(spokenScript([])).toBe('')
  })
})

describe('spokenWordCount and spokenSeconds', () => {
  it('counts every spoken word and says it at 2.4 words a second', () => {
    const beats = [beat('one two three  four'), beat(' '), beat('five six')]
    expect(spokenWordCount(beats)).toBe(6)
    expect(spokenSeconds([beat(Array.from({ length: 24 }, () => 'word').join(' '))])).toBe(10)
  })
})

describe('hookOf', () => {
  it('is the first sentence of the first beat', () => {
    expect(hookOf([beat('I was wrong about retries. Here is why.'), beat('Later.')])).toBe('I was wrong about retries.')
  })
  it('keeps a question or an exclamation whole, closing quote included', () => {
    expect(hookOf([beat('Why does n8n retry three times? Nobody asked.')])).toBe('Why does n8n retry three times?')
    expect(hookOf([beat('She said "stop." Then it stopped.')])).toBe('She said "stop."')
  })
  it('takes a beat without an end mark whole, and stops at a line break', () => {
    expect(hookOf([beat('  Retries without a limit  ')])).toBe('Retries without a limit')
    expect(hookOf([beat('First line without a mark\nSecond line.')])).toBe('First line without a mark')
  })
  it('does not end a sentence inside a version number or a domain', () => {
    expect(firstSentence('n8n 1.2 moved formstep.io links. Then more.')).toBe('n8n 1.2 moved formstep.io links.')
  })
  it('is empty without beats', () => {
    expect(hookOf([])).toBe('')
  })
})

describe('scriptProblems', () => {
  const none = { sponsorSegment: 'none', sponsorName: SPONSOR } as const
  const mention = { sponsorSegment: 'mention', sponsorName: SPONSOR } as const
  const demo = { sponsorSegment: 'demo', sponsorName: SPONSOR } as const

  it('needs a beat, and a title and a spoken line on every beat', () => {
    expect(scriptProblems([], none)).toEqual(['A script needs at least one beat.'])
    expect(scriptProblems([beat('Fine.'), beat(' ', 'n8n', ' ')], none)).toEqual(['Beat 2 has no title.', 'Beat 2 has no spoken line.'])
  })

  it('never names the sponsor when the episode carries none', () => {
    expect(scriptProblems([beat('Retry the node.'), beat('Watch the log.')], none)).toEqual([])
    expect(scriptProblems([beat('Retry the node.'), beat('Then send it to formstep.')], none)).toEqual([
      'Beat 2 names Formstep, but this episode carries no sponsor.',
    ])
  })

  it('says the sponsor in at least one beat for a mention', () => {
    expect(scriptProblems([beat('Retry the node.'), beat('This one is sponsored by Formstep.')], mention)).toEqual([])
    expect(scriptProblems([beat('Retry the node.')], mention)).toEqual(['A sponsored episode says Formstep in at least one beat.'])
  })

  it('shows the sponsor on screen in a beat of its own for a demo', () => {
    const shown = [beat('Retry the node.'), beat('Here is Formstep collecting the answer.', 'formstep')]
    expect(scriptProblems(shown, demo)).toEqual([])
    expect(scriptProblems([beat('Retry the node.'), beat('Formstep collects the answer.')], demo)).toEqual([
      'A sponsor demo needs a beat that shows Formstep on screen.',
    ])
    expect(scriptProblems([beat('Retry the node.'), beat('Here it is.', SPONSOR)], demo)).toEqual([
      'A sponsored episode says Formstep in at least one beat.',
    ])
  })
})

describe('lengthProblem', () => {
  const words = (count: number) => [beat(Array.from({ length: count }, () => 'word').join(' '))]

  it('takes half to one and a half times the target at 2.4 words a second', () => {
    // 40 s is 96 words: 48 to 144 fit.
    expect(lengthProblem(words(96), 40)).toBeNull()
    expect(lengthProblem(words(48), 40)).toBeNull()
    expect(lengthProblem(words(144), 40)).toBeNull()
  })

  it('names the count and the range when the script is too short or too long', () => {
    expect(lengthProblem(words(47), 40)).toBe('The script is 47 words; a 40 s video takes 48 to 144 (about 96).')
    expect(lengthProblem(words(145), 40)).toBe('The script is 145 words; a 40 s video takes 48 to 144 (about 96).')
  })
})
