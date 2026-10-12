import { describe, expect, it } from 'vitest'
import { PRESENTER_TOOL } from '../providers/llm'
import { shotsFromDraft } from './episodes'

const SPONSOR = 'Formstep'

/** A talking-head script: every beat is the presenter. */
const presenterBeats = {
  hook: 'Your agent failed again.',
  shotPlan: [
    { title: 'The hook', voiceover: 'Your agent failed again.', tool: PRESENTER_TOOL, url: '' },
    { title: 'The fix', voiceover: 'Read the log first.', tool: PRESENTER_TOOL, url: '' },
  ],
}

/** A screen script: a browser beat, then the sponsor's own screen. */
const screenBeats = {
  hook: 'Retry a failed webhook.',
  shotPlan: [
    { title: 'The problem', voiceover: 'Retry a failed webhook.', tool: 'browser', url: 'https://news.ycombinator.com' },
    { title: 'The fix', voiceover: 'Add an error workflow.', tool: 'n8n', url: 'http://localhost:5678' },
    { title: 'Formstep demo', voiceover: 'Here it is.', tool: SPONSOR, url: 'https://formstep.io' },
  ],
}

describe('shotsFromDraft', () => {
  it('speaks every beat to camera for a talking head', () => {
    expect(shotsFromDraft(screenBeats, SPONSOR, 'talking_head').map((shot) => shot.kind)).toEqual(['avatar', 'avatar', 'avatar'])
  })
  it('opens on the hook, then records the screens, for screen with avatar', () => {
    const shots = shotsFromDraft(screenBeats, SPONSOR, 'screen_with_avatar')
    expect(shots.map((shot) => shot.kind)).toEqual(['avatar', 'screen', 'screen'])
    expect(shots[0]?.voiceover).toBe(screenBeats.hook)
    const demo = shots[2]
    if (demo?.kind !== 'screen') throw new Error('the sponsor demo is a screen')
    expect(demo.recipe.map((step) => step.step)).toEqual(['goto', 'wait', 'scroll', 'wait'])
  })
  it('keeps a presenter beat as a take under a screen delivery', () => {
    // The beats a talking-head script stored, after the episode widened to a screen platform.
    for (const delivery of ['screen_only', 'screen_with_avatar'] as const) {
      const shots = shotsFromDraft(presenterBeats, SPONSOR, delivery)
      expect(shots.map((shot) => shot.kind)).toEqual(['avatar', 'avatar'])
      expect(shots.map((shot) => shot.voiceover)).toEqual(presenterBeats.shotPlan.map((beat) => beat.voiceover))
    }
  })
})
