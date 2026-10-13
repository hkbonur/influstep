import { scriptDayOf } from '@influstep/shared'
import type { Id } from '../src/_generated/dataModel'
import { instantAt } from '../src/core/dates'
import { queueDueScripts } from '../src/core/episodes'
import type { setup } from './setup'

/**
 * The due-script pass (core `queueDueScripts`, which the 07:30 cron runs
 * through internal/schedule.ts `writeDueScripts`) on the persona's morning
 * before `plannedFor`, then every job it queued. It runs at that morning's
 * time rather than now, so a test can write next week's scripts without
 * waiting for them; an idea planned before that morning's day fails, as it
 * would then.
 */
export async function writeScriptsDueBefore(
  t: ReturnType<typeof setup>,
  personaId: Id<'personas'>,
  plannedFor: string
): Promise<{ queued: number; failed: number }> {
  const outcome = await t.run(async (ctx) => {
    const persona = await ctx.db.get(personaId)
    if (!persona) throw new Error('persona vanished')
    return queueDueScripts(ctx, persona, instantAt(scriptDayOf(plannedFor), 9, persona.timezone))
  })
  await t.finishAllScheduledFunctions(() => {})
  return outcome
}
