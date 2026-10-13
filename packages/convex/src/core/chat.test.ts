import { describe, expect, it } from 'vitest'
import { insertEpisode, insertPersona, insertPublication, TIMEZONE } from '../../test/fixtures'
import { setup } from '../../test/setup'
import { applyChatIntent, changeablePlan } from './chat'
import { addDays, dayKey, weekStart } from './dates'

describe('changeablePlan', () => {
  it('holds what a chat change may touch, from today to the end of next week, by publish time', async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const lastDay = addDays(weekStart(today), 13)
    const { persona, expected } = await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const at = (status: Parameters<typeof insertEpisode>[2]['status'], plannedFor: string, concept: string) =>
        insertEpisode(ctx, persona, { status, plannedFor, concept })

      // In: every changeable status, today and the last day of next week included.
      const lastIdea = await at('idea', lastDay, 'last day idea')
      const todayIdea = await at('idea', today, 'today idea')
      const scripted = await at('scripted', today, 'scripted')
      const waiting = await at('waiting_on_you', today, 'waiting')
      const failed = await at('failed', today, 'failed')
      const rendered = await at('rendered', today, 'rendered')
      const scheduled = await at('scheduled', today, 'scheduled with drafts only')
      await insertPublication(ctx, scheduled, { platform: 'youtube', status: 'queued' })

      // Out: gone out, over, being recorded, past, beyond next week, or a scheduled one already out on a platform.
      await at('published', today, 'published')
      await at('killed', today, 'killed')
      await at('measured', today, 'measured')
      await at('recording', today, 'recording')
      await at('idea', addDays(today, -1), 'yesterday')
      await at('idea', addDays(weekStart(today), -3), 'last week')
      await at('idea', addDays(lastDay, 1), 'beyond next week')
      const partlyLive = await at('scheduled', today, 'scheduled and live on X')
      await insertPublication(ctx, partlyLive, { platform: 'youtube', status: 'queued' })
      await insertPublication(ctx, partlyLive, { platform: 'x', status: 'live' })
      const uploading = await at('scheduled', today, 'scheduled and uploading')
      await insertPublication(ctx, uploading, { platform: 'youtube', status: 'uploading' })

      const expected = [todayIdea, scripted, waiting, failed, rendered, scheduled, lastIdea].map((episode) => episode.concept)
      return { persona, expected }
    })

    const plan = await t.run((ctx) => changeablePlan(ctx, persona._id))

    // Today's rows share a publish time; insertion order breaks the tie through the index.
    expect(plan.map((episode) => episode.concept)).toEqual(expected)
  })
})

describe('applyChatIntent', () => {
  it('needs the provider reply for a directive or a conversation, and treats its absence as a bug', async () => {
    const t = setup()
    const { persona, messageId } = await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      const messageId = await ctx.db.insert('messages', { personaId: persona._id, author: 'operator', text: 'hi', createdAt: Date.now() })
      return { persona, messageId }
    })
    await expect(t.run((ctx) => applyChatIntent(ctx, persona, messageId, { kind: 'conversation' }, null))).rejects.toThrow(
      "a conversation message is answered with the provider's reply, and none was given"
    )
  })

  it('asks which one when a target matches several episodes, and changes nothing', async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const { persona, messageId } = await t.run(async (ctx) => {
      const persona = await insertPersona(ctx)
      await insertEpisode(ctx, persona, { status: 'idea', plannedFor: today, concept: 'n8n retries' })
      await insertEpisode(ctx, persona, { status: 'idea', plannedFor: today, concept: 'n8n webhooks' })
      const messageId = await ctx.db.insert('messages', {
        personaId: persona._id,
        author: 'operator',
        text: 'drop the n8n one',
        createdAt: Date.now(),
      })
      return { persona, messageId }
    })

    const outcome = await t.run((ctx) => applyChatIntent(ctx, persona, messageId, { kind: 'drop', target: { keyword: 'n8n' } }, null))

    expect(outcome.text).toMatch(/^That matches 2 episodes: .+n8n retries; .+n8n webhooks\. Which one\?$/)
    const statuses = await t.run(async (ctx) => (await ctx.db.query('episodes').collect()).map((episode) => episode.status))
    expect(statuses).toEqual(['idea', 'idea'])
  })
})
