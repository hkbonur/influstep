import { describe, expect, it } from 'vitest'
import {
  DRAFT_STALE_MS,
  REPLY_FRESH_MS,
  engagedFirst,
  heardVerdict,
  namesSponsor,
  replyProblems,
  replyRuleCovers,
  replyRuleOf,
  type HeardPost,
} from './replies'

const NOW = Date.UTC(2026, 9, 13, 12)
const HOUR = 3_600_000

function heard(overrides: Partial<HeardPost> = {}): HeardPost {
  return {
    origin: 'search',
    externalId: '1840',
    text: 'What is your go-to setup for n8n tutorials?',
    url: 'https://x.com/dana_automates/status/1840',
    postedAt: NOW - HOUR,
    author: { handle: 'dana_automates', name: 'Dana Ruiz', followers: 12_400 },
    pillar: 'n8n tutorials',
    ...overrides,
  }
}

const CONTEXT = { personaHandle: 'ada_builds', sponsorName: 'Formstep', answered: new Set<string>(), now: NOW }

describe('what the listener keeps', () => {
  it('keeps a recent post with reach in the pillars', () => {
    expect(heardVerdict(heard(), CONTEXT)).toEqual({ kind: 'keep' })
  })

  it("drops the persona's own posts, answered posts, old posts, and found posts without reach", () => {
    expect(heardVerdict(heard({ author: { handle: '@Ada_Builds', name: 'Ada', followers: 9000 } }), CONTEXT).kind).toBe('drop')
    expect(heardVerdict(heard(), { ...CONTEXT, answered: new Set(['1840']) }).kind).toBe('drop')
    expect(heardVerdict(heard({ postedAt: NOW - REPLY_FRESH_MS.search - 1 }), CONTEXT).kind).toBe('drop')
    expect(heardVerdict(heard({ author: { handle: 'tomtries', name: 'Tom', followers: 410 } }), CONTEXT).kind).toBe('drop')
  })

  it('keeps a mention from a small account, and for longer than a found post', () => {
    const mention = heard({ origin: 'mention', author: { handle: 'tomtries', name: 'Tom', followers: 410 }, postedAt: NOW - 20 * HOUR })
    expect(heardVerdict(mention, CONTEXT)).toEqual({ kind: 'keep' })
    expect(engagedFirst('mention')).toBe(true)
    expect(engagedFirst('reply')).toBe(true)
    expect(engagedFirst('search')).toBe(false)
  })

  it('passes on a post naming the sponsor, with the reason the operator reads', () => {
    expect(heardVerdict(heard({ text: "Has anyone tried formstep's forms?" }), CONTEXT)).toEqual({
      kind: 'skip',
      reason: 'It names Formstep; the persona answers about its sponsor only when you ask.',
    })
    expect(namesSponsor('Formsteps are hard', 'Formstep')).toBe(false)
    expect(DRAFT_STALE_MS).toBeGreaterThan(REPLY_FRESH_MS.search)
  })
})

describe('what a reply may say', () => {
  const sponsor = { sponsorName: 'Formstep', sponsorAllowed: false }

  it('takes a short reply without a link or the sponsor', () => {
    expect(replyProblems('Cap the retries and alert on the last one.', sponsor)).toEqual([])
  })

  it("refuses an empty reply, one over X's limit, a link, and the sponsor nobody asked about", () => {
    expect(replyProblems('  ', sponsor)).toEqual(['Write the reply.'])
    expect(replyProblems('a'.repeat(281), sponsor)).toEqual(['A reply is at most 280 characters; this one is 281.'])
    expect(replyProblems('See https://example.com', sponsor)).toEqual(['Leave links out of a reply.'])
    expect(replyProblems('Formstep does this.', sponsor)).toEqual(['Leave Formstep out of this reply; nobody asked about it.'])
    expect(replyProblems('Formstep does this.', { ...sponsor, sponsorAllowed: true })).toEqual([])
  })
})

describe('reply rules', () => {
  it('reads what a never and an only rule cover', () => {
    expect(replyRuleOf('Never reply to politics.')).toEqual({ kind: 'never', words: ['politic'] })
    expect(replyRuleOf('Only reply to people building agents.')).toEqual({ kind: 'only', words: ['building', 'agent'] })
    expect(replyRuleOf('Never open with a question.')).toBeNull()
  })

  it('passes on a post a never rule names and a post an only rule does not', () => {
    expect(replyRuleCovers('Never reply to politics.', 'Politics aside, the new AI bill could change n8n.')).toBe(true)
    expect(replyRuleCovers('Never reply to politics.', 'What is your go-to n8n setup?')).toBe(false)
    expect(replyRuleCovers('Only reply to people building agents.', 'Is n8n still worth learning, or is it all agents now?')).toBe(false)
    expect(replyRuleCovers('Only reply to people building agents.', 'What is your go-to n8n setup?')).toBe(true)
  })
})
