import { describe, expect, it } from 'vitest'
import { freeHandle, handleFromName, parsePillars, proposalProblems } from './onboarding'

const PROPOSAL = {
  niche: 'Notion for freelancers',
  audience: 'freelance designers',
  name: 'Nora Notes',
  handle: 'nora.notes',
  tone: 'warm and direct',
  pillars: ['Client portals', 'Templates', 'Invoicing'],
  bio: 'One Notion setup a day.',
  bible: 'Nora shows before she tells.',
}

describe('handleFromName', () => {
  it('joins the words with dots and keeps what a handle may hold', () => {
    expect(handleFromName('Nora Notes')).toBe('nora.notes')
    expect(handleFromName('  Zoë & the Agents! ')).toBe('zoe.the.agents')
  })
})

describe('freeHandle', () => {
  it('keeps a free handle and numbers a taken one', () => {
    expect(freeHandle('nora.notes', [])).toBe('nora.notes')
    expect(freeHandle('nora.notes', ['nora.notes', 'nora.notes2'])).toBe('nora.notes3')
  })
})

describe('parsePillars', () => {
  it('splits on commas and drops empty ones', () => {
    expect(parsePillars(' a, b ,, c ')).toEqual(['a', 'b', 'c'])
  })
})

describe('proposalProblems', () => {
  it('has none for a full proposal', () => {
    expect(proposalProblems(PROPOSAL, ['ada.automates'])).toEqual([])
  })

  it('names a taken or malformed handle, a pillar count out of bounds and a pillar named twice', () => {
    expect(proposalProblems(PROPOSAL, ['nora.notes'])).toEqual(['The handle nora.notes is taken.'])
    expect(proposalProblems({ ...PROPOSAL, handle: 'Nora Notes' }, [])).toEqual([
      'A handle is 3 to 30 lower-case letters, digits, dots, dashes or underscores.',
    ])
    expect(proposalProblems({ ...PROPOSAL, pillars: ['a', 'b'] }, [])).toEqual(['Give 3 to 5 content pillars, comma separated.'])
    expect(proposalProblems({ ...PROPOSAL, pillars: ['a', 'B', 'b'] }, [])).toEqual(['Each content pillar is named once.'])
  })

  it('asks for every empty field', () => {
    expect(
      proposalProblems(
        { niche: '', audience: '', name: '', handle: 'ok.handle', tone: '', pillars: ['a', 'b', 'c'], bio: '', bible: '' },
        []
      )
    ).toHaveLength(6)
  })
})
