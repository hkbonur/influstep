import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { bioLinkOf } from './core/episodes'
import { setup } from '../test/setup'

type Test = ReturnType<typeof setup>

async function seeded(): Promise<{ t: Test; adaId: Id<'personas'>; maxId: Id<'personas'> }> {
  const t = setup()
  await t.action(internal.internal.seed.run, { appUrl: 'http://localhost:3300' })
  await t.finishAllScheduledFunctions(() => {})
  const personas = await t.query(api.private.personas.list, {})
  const ada = personas.find((persona) => persona.handle === 'ada.automates')
  const max = personas.find((persona) => persona.handle === 'max.builds.agents')
  if (!ada || !max) throw new Error('the seed has no Ada or Max')
  return { t, adaId: ada._id, maxId: max._id }
}

describe('workspace report', () => {
  it('adds every persona up, the one that earns first, each row the persona report’s own funnel', async () => {
    const { t, adaId, maxId } = await seeded()
    const report = await t.query(api.private.report.forWorkspace, {})

    // Ada brings paying customers; Max, on TikTok only, brings views and clicks through his bio but nothing paid yet.
    expect(report.personas.map((row) => row.persona._id)).toEqual([adaId, maxId])
    const [ada, max] = report.personas
    if (!ada || !max) throw new Error('two rows expected')
    expect(ada.funnel.value).toBeGreaterThan(0)
    expect(max.funnel).toMatchObject({ paid: 0, value: 0 })
    expect(max.funnel.views).toBeGreaterThan(0)
    expect(max.funnel.clicks).toBeGreaterThan(0)

    for (const key of ['views', 'follows', 'likes', 'comments', 'clicks', 'demos', 'signups', 'trials', 'paid', 'value'] as const) {
      expect(report.total[key]).toBe(ada.funnel[key] + max.funnel[key])
    }
    expect(report.total.watchRate).not.toBeNull()

    const adaReport = await t.query(api.private.report.forPersona, { personaId: adaId })
    expect(adaReport?.funnel).toEqual(ada.funnel)
  })

  it('ranks what works over both personas’ measured videos, by the hook style each went out with', async () => {
    const { t } = await seeded()
    const { whatWorks } = await t.query(api.private.report.forWorkspace, {})

    expect(whatWorks.videos).toBeGreaterThan(0)
    // Max's pillars sit next to Ada's: the lists are the workspace's, not one persona's.
    expect(whatWorks.pillar.map((group) => group.key)).toEqual(expect.arrayContaining(['n8n tutorials', 'MCP servers']))
    // The confession hook goes by its catalog name, whatever the experiment called it; every seeded video has a style.
    expect(whatWorks.hook.map((group) => group.label).sort()).toEqual(['Confession', 'How to'])
    expect(whatWorks.hook.reduce((sum, group) => sum + group.videos, 0)).toBe(whatWorks.videos)
    expect(whatWorks.sponsor.reduce((sum, group) => sum + group.videos, 0)).toBe(whatWorks.videos)
    for (const list of [whatWorks.pillar, whatWorks.hook, whatWorks.sponsor]) {
      const ranked = [...list].sort((a, b) => b.valuePerVideo - a.valuePerVideo || b.clicksPerView - a.clicksPerView)
      expect(list.map((group) => group.key)).toEqual(ranked.map((group) => group.key))
    }
  })

  it('stamps the hook style a script is written in', async () => {
    const { t, maxId } = await seeded()
    // Max's idea for tomorrow is written as soon as the seed queues it, in his default hook style.
    const page = await t.query(api.private.personas.get, { personaId: maxId })
    const written = page?.episodes.find((episode) => episode.status !== 'idea' && episode.status !== 'measured')
    if (!written) throw new Error('Max has no written video')
    expect(written.hookStyle).toEqual({ key: 'howto', label: 'How to' })
  })
})

describe('link in bio by platform', () => {
  it('counts a bio click for the platform whose bio opened the page, and tells Formstep where it came from', async () => {
    const { t, adaId } = await seeded()
    const bio = await t.run(async (ctx) => bioLinkOf(ctx, adaId))
    if (!bio) throw new Error('Ada has no bio link')
    const before = await t.query(api.private.report.forPersona, { personaId: adaId })
    const youtubeBefore = before?.platforms.find((row) => row.platform === 'youtube')?.bioClicks

    const click = await t.mutation(api.public.links.click, { slug: bio.slug, via: 'youtube' })
    expect(new URL(click?.target ?? '').searchParams.get('utm_medium')).toBe('youtube')
    const plain = await t.mutation(api.public.links.click, { slug: bio.slug })
    expect(new URL(plain?.target ?? '').searchParams.get('utm_medium')).toBe('bio')

    const after = await t.query(api.private.report.forPersona, { personaId: adaId })
    expect(after?.platforms.find((row) => row.platform === 'youtube')?.bioClicks).toBe((youtubeBefore ?? 0) + 1)
  })

  it('leaves an episode link’s platform alone whatever the URL says', async () => {
    const { t, adaId } = await seeded()
    const link = await t.run(async (ctx) =>
      (
        await ctx.db
          .query('links')
          .withIndex('by_persona', (q) => q.eq('personaId', adaId))
          .collect()
      ).find((candidate) => candidate.platform === 'tiktok')
    )
    if (!link) throw new Error('Ada has no TikTok link')
    const click = await t.mutation(api.public.links.click, { slug: link.slug, via: 'youtube' })
    expect(new URL(click?.target ?? '').searchParams.get('utm_medium')).toBe('tiktok')
    const stored = await t.run(async (ctx) =>
      ctx.db
        .query('linkClicks')
        .withIndex('by_link', (q) => q.eq('linkId', link._id))
        .collect()
    )
    expect(stored.some((row) => row.via !== undefined)).toBe(false)
  })
})
