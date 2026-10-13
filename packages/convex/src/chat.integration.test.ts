import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { codeGivenText } from './core/discounts'
import { instantAt } from './core/dates'
import { mockLlm } from './providers/llm/mock'
import { insertEpisode, insertJob, insertPersona, insertPublication, TIMEZONE, VIDEO_HOUR } from '../test/fixtures'
import { setup } from '../test/setup'

/**
 * The chat that changes the plan (docs/plan.md, slice 7), end to end with the
 * mock interpreter (shared parseChatIntent): the operator sends a message,
 * the persona reads it once, applies it and replies in the chat. The clock
 * stands on Wednesday 14 October 2026 in Oslo, so every weekday in a message
 * names a known day.
 */

const TODAY = '2026-10-14'
const THIS_THURSDAY = '2026-10-15'
const NEXT_TUESDAY = '2026-10-20'
const NEXT_FRIDAY = '2026-10-23'
const NEXT_SATURDAY = '2026-10-24'

beforeEach(() => {
  // Only Date is faked, and it keeps running, so the scheduler's timers and the rows' creation order are real.
  vi.useFakeTimers({ now: instantAt(TODAY, 10, TIMEZONE), toFake: ['Date'], shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type Harness = ReturnType<typeof setup>

/** Ada and three episodes: a scripted video this Thursday, an n8n idea next Tuesday, a publish package next Friday. */
async function plan(t: Harness) {
  return t.run(async (ctx) => {
    const persona = await insertPersona(ctx)
    const thursday = await insertEpisode(ctx, persona, {
      status: 'scripted',
      plannedFor: THIS_THURSDAY,
      concept: 'Error workflows that page you once',
    })
    const tuesday = await insertEpisode(ctx, persona, {
      status: 'idea',
      plannedFor: NEXT_TUESDAY,
      concept: 'Retry an n8n webhook',
      pillar: 'n8n tutorials',
    })
    const friday = await insertEpisode(ctx, persona, {
      status: 'rendered',
      plannedFor: NEXT_FRIDAY,
      concept: 'Pause a workflow until the customer signs off',
    })
    const fridayDraft = await insertPublication(ctx, friday, { platform: 'youtube', status: 'draft' })
    return { persona, thursday, tuesday, friday, fridayDraft }
  })
}

/** Sends a message as the operator and waits until the persona has read it and everything it queued has run. */
async function say(t: Harness, persona: Doc<'personas'>, text: string): Promise<void> {
  await t.mutation(api.private.personas.sendMessage, { personaId: persona._id, text })
  await t.finishAllScheduledFunctions(() => {})
}

/** The persona's messages after the operator's last one, oldest first. */
async function repliesTo(t: Harness, persona: Doc<'personas'>): Promise<Doc<'messages'>[]> {
  const messages = await t.run((ctx) =>
    ctx.db
      .query('messages')
      .withIndex('by_persona', (q) => q.eq('personaId', persona._id))
      .collect()
  )
  const lastAsk = messages.map((message) => message.author).lastIndexOf('operator')
  return messages.slice(lastAsk + 1)
}

async function onlyReply(t: Harness, persona: Doc<'personas'>): Promise<Doc<'messages'>> {
  const replies = await repliesTo(t, persona)
  expect(replies.map((reply) => reply.author)).toEqual(['persona'])
  const [reply] = replies
  if (!reply) throw new Error('no reply')
  return reply
}

async function jobKindsOf(t: Harness, episodeId: Id<'episodes'>): Promise<string[]> {
  const jobs = await t.run((ctx) =>
    ctx.db
      .query('jobs')
      .withIndex('by_episode', (q) => q.eq('episodeId', episodeId))
      .collect()
  )
  return jobs.map((job) => job.kind)
}

async function episode(t: Harness, episodeId: Id<'episodes'>): Promise<Doc<'episodes'>> {
  const row = await t.run((ctx) => ctx.db.get(episodeId))
  if (!row) throw new Error(`episode ${episodeId} not found`)
  return row
}

describe('chat changes the plan', () => {
  it('replaces an episode: the old one is killed and a new idea takes its day, written the day before', async () => {
    const t = setup()
    const { persona, tuesday } = await plan(t)

    await say(t, persona, "Replace Tuesday's n8n episode with one about Make")

    expect((await episode(t, tuesday._id)).status).toBe('killed')
    const reply = await onlyReply(t, persona)
    expect(reply.text).toBe('Replaced Tuesday\'s "Retry an n8n webhook" with "Make". The writer writes it on Mon 19 Oct.')
    if (reply.episodeId === undefined) throw new Error('the reply links no episode')
    const replacement = await episode(t, reply.episodeId)
    expect([replacement.concept, replacement.plannedFor, replacement.kind, replacement.pillar]).toEqual([
      'Make',
      NEXT_TUESDAY,
      'video',
      'n8n tutorials',
    ])
    expect(replacement.platforms).toEqual(tuesday.platforms)
    expect(await jobKindsOf(t, replacement._id)).toEqual([])
  })

  it("replaces tomorrow's episode with the writer on it at once", async () => {
    const t = setup()
    const { persona, thursday } = await plan(t)

    await say(t, persona, "Replace Thursday's episode with one about Zapier")

    expect((await episode(t, thursday._id)).status).toBe('killed')
    const reply = await onlyReply(t, persona)
    expect(reply.text).toBe('Replaced Thursday\'s "Error workflows that page you once" with "Zapier". The writer is on it.')
    if (reply.episodeId === undefined) throw new Error('the reply links no episode')
    const replacement = await episode(t, reply.episodeId)
    expect([replacement.concept, replacement.plannedFor]).toEqual(['Zapier', THIS_THURSDAY])
    expect(await jobKindsOf(t, replacement._id)).toEqual(['write_script'])
  })

  it('moves an episode within its week, its waiting drafts along', async () => {
    const t = setup()
    const { persona, friday, fridayDraft } = await plan(t)

    await say(t, persona, 'move Friday to Saturday')

    const reply = await onlyReply(t, persona)
    expect([reply.text, reply.episodeId]).toEqual([
      'Moved "Pause a workflow until the customer signs off" from Friday to Saturday.',
      friday._id,
    ])
    expect((await episode(t, friday._id)).plannedFor).toBe(NEXT_SATURDAY)
    const draft = await t.run((ctx) => ctx.db.get(fridayDraft._id))
    expect(draft?.scheduledAt).toBe(instantAt(NEXT_SATURDAY, VIDEO_HOUR, TIMEZONE))
  })

  it('drops an episode', async () => {
    const t = setup()
    const { persona, tuesday } = await plan(t)

    await say(t, persona, 'drop the webhook one')

    const reply = await onlyReply(t, persona)
    expect([reply.text, reply.episodeId]).toEqual([
      'Dropped "Retry an n8n webhook" (Tuesday). It stays in the calendar as killed.',
      tuesday._id,
    ])
    expect((await episode(t, tuesday._id)).status).toBe('killed')
  })

  it('asks which one when the message names several episodes, and changes nothing', async () => {
    const t = setup()
    const { persona, tuesday } = await plan(t)
    const other = await t.run((ctx) =>
      insertEpisode(ctx, persona, { status: 'idea', plannedFor: NEXT_FRIDAY, concept: 'n8n or Make for a small team' })
    )

    await say(t, persona, 'drop the n8n one')

    const reply = await onlyReply(t, persona)
    expect(reply.text).toBe(
      'That matches 2 episodes: Tue 20 Oct: Retry an n8n webhook; Fri 23 Oct: n8n or Make for a small team. Which one?'
    )
    expect([(await episode(t, tuesday._id)).status, (await episode(t, other._id)).status]).toEqual(['idea', 'idea'])
  })

  it('lists the plan when the message names no episode of it', async () => {
    const t = setup()
    const { persona } = await plan(t)

    await say(t, persona, 'drop the pricing one')

    const reply = await onlyReply(t, persona)
    expect(reply.text).toBe(
      [
        'I could not find an episode of mine that matches. Planned:',
        'Thu 15 Oct: Error workflows that page you once',
        'Tue 20 Oct: Retry an n8n webhook',
        'Fri 23 Oct: Pause a workflow until the customer signs off',
      ].join('\n')
    )
  })

  it('refuses a move to a day that has passed, in the reply', async () => {
    const t = setup()
    const { persona, thursday } = await plan(t)

    await say(t, persona, 'move Thursday to Monday')

    const reply = await onlyReply(t, persona)
    expect([reply.text, reply.episodeId]).toEqual([
      'Mon 12 Oct has passed, so "Error workflows that page you once" stays on Thursday.',
      thursday._id,
    ])
    expect((await episode(t, thursday._id)).plannedFor).toBe(THIS_THURSDAY)
  })

  it('stores a directive and marks the operator message that became it', async () => {
    const t = setup()
    const { persona } = await plan(t)

    await say(t, persona, 'focus on n8n error handling for two weeks')

    const directives = await t.run((ctx) => ctx.db.query('directives').collect())
    expect(directives.map((directive) => [directive.text, directive.active])).toEqual([['focus on n8n error handling for two weeks', true]])
    const [directive] = directives
    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    const ask = messages.find((message) => message.author === 'operator')
    expect(ask?.directiveId).toBe(directive?._id)
    const reply = await onlyReply(t, persona)
    expect(reply.directiveId).toBe(directive?._id)
  })
})

describe('chat gives a code', () => {
  it('asks what the code gives when the message does not say, and gives nothing', async () => {
    const t = setup()
    const { persona } = await plan(t)

    await say(t, persona, 'use code ADA20')

    const reply = await onlyReply(t, persona)
    expect(reply.text).toBe('What does ADA20 give? Say for example: use code ADA20, 20% off Pro for 3 months.')
    expect(await t.run((ctx) => ctx.db.query('discountCodes').collect())).toEqual([])
  })

  it('gives the code to the persona, confirmed once', async () => {
    const t = setup()
    const { persona } = await plan(t)

    await say(t, persona, 'use code ADA20, 20% off Pro for 3 months')

    const codes = await t.run((ctx) => ctx.db.query('discountCodes').collect())
    expect(codes.map((code) => [code.code, code.offer, code.episodeId, code.active])).toEqual([
      ['ADA20', '20% off Pro for 3 months', undefined, true],
    ])
    const reply = await onlyReply(t, persona)
    expect(reply.text).toBe(codeGivenText({ code: 'ADA20', offer: '20% off Pro for 3 months', episodeTitle: null }))
  })

  it('binds the code to the next video when asked, confirmed once', async () => {
    const t = setup()
    const { persona, thursday } = await plan(t)

    await say(t, persona, 'use code ADA20: 20% off Pro for 3 months for the next video')

    const codes = await t.run((ctx) => ctx.db.query('discountCodes').collect())
    expect(codes.map((code) => [code.code, code.episodeId])).toEqual([['ADA20', thursday._id]])
    const reply = await onlyReply(t, persona)
    expect([reply.text, reply.episodeId]).toEqual([
      codeGivenText({ code: 'ADA20', offer: '20% off Pro for 3 months', episodeTitle: thursday.title }),
      thursday._id,
    ])
  })

  it('says why when the code is in use elsewhere, and gives nothing', async () => {
    const t = setup()
    const { persona } = await plan(t)
    await t.run(async (ctx) => {
      const max = await insertPersona(ctx, { name: 'Max Builds Agents', handle: 'max.builds.agents' })
      await ctx.db.insert('discountCodes', {
        personaId: max._id,
        code: 'MAX10',
        offer: '10% off',
        active: true,
        redemptions: 0,
        createdAt: Date.now(),
      })
    })

    await say(t, persona, 'use code MAX10, 10% off')

    const reply = await onlyReply(t, persona)
    expect(reply.text).toBe("MAX10 is already Max Builds Agents's code; retire it first.")
    const codes = await t.run((ctx) => ctx.db.query('discountCodes').collect())
    expect(codes.map((code) => code.personaId)).not.toContain(persona._id)
  })
})

describe('chat remembers', () => {
  async function memoriesOf(t: Harness, persona: Doc<'personas'>): Promise<Doc<'memories'>[]> {
    return t.run((ctx) =>
      ctx.db
        .query('memories')
        .withIndex('by_persona_status', (q) => q.eq('personaId', persona._id))
        .collect()
    )
  }

  it('keeps a fact with the message as its evidence, its quotes intact, and says so once', async () => {
    const t = setup()
    const { persona } = await plan(t)

    await say(t, persona, "remember that viewers hate the word 'guys'")

    const [fact, ...others] = await memoriesOf(t, persona)
    expect(others).toEqual([])
    const ask = (await t.run((ctx) => ctx.db.query('messages').collect())).find((message) => message.author === 'operator')
    expect(fact).toMatchObject({
      kind: 'fact',
      text: "Viewers hate the word 'guys'",
      actor: 'operator',
      evidence: { episodeIds: [], signalIds: [], messageId: ask?._id },
      status: 'active',
    })
    const reply = await onlyReply(t, persona)
    expect(reply.text).toBe(`I will remember that: "Viewers hate the word 'guys'" I read what I know before every script and post.`)
  })

  it('keeps a rule, and says it already knows the same words told again', async () => {
    const t = setup()
    const { persona } = await plan(t)

    await say(t, persona, 'Remember to always show the URL bar, please')
    expect((await onlyReply(t, persona)).text).toBe(
      'I will keep this rule: "Always show the URL bar." I read my rules before every script and post.'
    )
    await say(t, persona, 'note that always show the url bar.')

    expect((await onlyReply(t, persona)).text).toBe('I already remember that: "Always show the URL bar."')
    expect((await memoriesOf(t, persona)).map((entry) => [entry.kind, entry.text])).toEqual([['rule', 'Always show the URL bar.']])
  })
})

describe('chat tasks', () => {
  it('queues a research brief with the researcher, which answers in the chat', async () => {
    const t = setup()
    const { persona } = await plan(t)

    await say(t, persona, 'research brief on Make vs n8n')

    const jobs = await t.run((ctx) => ctx.db.query('jobs').collect())
    const brief = jobs.find((job) => job.kind === 'research_brief')
    if (!brief) throw new Error('no research brief was queued')
    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    const ask = messages.find((message) => message.author === 'operator')
    expect([brief.role, brief.status, brief.personaId, brief.messageId]).toEqual(['researcher', 'done', persona._id, ask?._id])
    expect(brief.payload).toEqual({ personaId: persona._id, topic: 'Make vs n8n', messageId: ask?._id })

    const replies = await repliesTo(t, persona)
    expect(replies.map((reply) => [reply.author, reply.jobId])).toEqual([
      ['persona', brief._id],
      ['persona', brief._id],
    ])
    const [ack, report] = replies
    expect(ack?.text).toBe('Asked the researcher for a research brief on Make vs n8n. It lands here when it is done.')
    expect(brief.result).toEqual({ messageId: report?._id })
  })

  it('filters a research brief by the whole topic, or by either side of a comparison', async () => {
    const t = setup()
    const { persona } = await plan(t)
    await t.run(async (ctx) => {
      const titles = [
        'The n8n Error Trigger node, explained',
        'The other side of webhooks',
        'Make scenarios that retry',
        'Weather alerts in n8n',
        'Design a customer signup flow',
      ]
      for (const [index, title] of titles.entries())
        await ctx.db.insert('signals', {
          personaId: persona._id,
          source: 'hackernews',
          externalId: `hn-${index}`,
          title,
          url: `https://news.ycombinator.com/item?id=${index}`,
          summary: '',
          score: 10,
          topics: [],
          status: 'new',
          foundAt: Date.now(),
          mock: true,
        })
    })

    await say(t, persona, 'research brief on the n8n error trigger')
    expect((await repliesTo(t, persona)).at(-1)?.text).toBe(
      '1 new signal on the n8n error trigger: "The n8n Error Trigger node, explained".'
    )

    await say(t, persona, 'research brief on Make vs n8n')
    const comparison = (await repliesTo(t, persona)).at(-1)?.text
    expect(comparison).toContain('3 new signals on Make vs n8n')
    expect(comparison).not.toContain('The other side of webhooks')

    await say(t, persona, 'research brief on customer sign-off')
    expect((await repliesTo(t, persona)).at(-1)?.text).toBe('No new signals on customer sign-off.')
  })

  it('says in the chat when a task fails', async () => {
    const t = setup()
    const { persona } = await plan(t)
    vi.spyOn(mockLlm, 'taskReport').mockRejectedValue(new Error('the model is down'))

    await say(t, persona, 'comment digest please')

    const jobs = await t.run((ctx) => ctx.db.query('jobs').collect())
    const digest = jobs.find((job) => job.kind === 'comment_digest')
    if (!digest) throw new Error('no comment digest was queued')
    expect([digest.role, digest.status]).toEqual(['publisher', 'failed'])
    const replies = await repliesTo(t, persona)
    expect(replies.map((reply) => reply.jobId)).toEqual([digest._id, digest._id])
    const failure = replies.at(-1)?.text
    expect(failure).toContain('The publisher could not finish the comment digest: ')
    expect(failure).toContain('the model is down')
  })
})

describe('agents board', () => {
  it('lists the five roles with each job in its bucket', async () => {
    const t = setup()
    const { persona, thursday, tuesday } = await plan(t)
    const jobs = await t.run(async (ctx) => {
      const producing = await insertJob(ctx, thursday, { kind: 'produce', status: 'running' })
      const firstScript = await insertJob(ctx, tuesday, { kind: 'write_script', status: 'queued' })
      const secondScript = await insertJob(ctx, thursday, { kind: 'write_script', status: 'queued' })
      const messageId = await ctx.db.insert('messages', {
        personaId: persona._id,
        author: 'operator',
        text: 'what are people saying in the comments',
        createdAt: Date.now(),
      })
      const digestId = await ctx.db.insert('jobs', {
        kind: 'comment_digest',
        role: 'publisher',
        runsOn: 'backend',
        status: 'failed',
        personaId: persona._id,
        messageId,
        payload: { personaId: persona._id, messageId },
        error: 'the model is down',
        attempts: 1,
        createdAt: Date.now(),
        startedAt: Date.now(),
        finishedAt: Date.now(),
      })
      return { producing, firstScript, secondScript, digestId }
    })

    const board = await t.query(api.private.agents.board, {})

    expect(board.roles.map((row) => row.role)).toEqual(['researcher', 'writer', 'producer', 'publisher', 'analyst'])
    const row = (role: string) => {
      const found = board.roles.find((candidate) => candidate.role === role)
      if (!found) throw new Error(`no ${role} row`)
      return found
    }
    expect(row('producer').running.map((job) => [job._id, job.persona?.name, job.episode?.title])).toEqual([
      [jobs.producing._id, persona.name, thursday.title],
    ])
    expect(row('writer').queued.count).toBe(2)
    expect(row('writer').queued.next.map((job) => job._id)).toEqual([jobs.firstScript._id, jobs.secondScript._id])
    expect(row('publisher').recent.map((job) => [job._id, job.status, job.error, job.brief])).toEqual([
      [jobs.digestId, 'failed', 'the model is down', 'what are people saying in the comments'],
    ])
    expect(row('researcher')).toEqual({ role: 'researcher', running: [], queued: { count: 0, next: [] }, recent: [] })
    expect(board.runnerLastSeenAt).toBeNull()
  })
})
