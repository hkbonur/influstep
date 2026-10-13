import { STRATEGY_REVIEW_SLOT } from '@influstep/shared'
import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

/**
 * The persona's clock. Everything here fans out per active persona through
 * internal/schedule.ts, so a paused persona is skipped at the source.
 */
const crons = cronJobs()

crons.interval('poll signals for every persona', { hours: 1 }, internal.internal.schedule.pollSignals, {})
crons.interval('dispatch publications whose time has come', { minutes: 5 }, internal.internal.runner.dispatchDuePublications, {})
crons.daily('pull metrics and decide experiments', { hourUTC: 5, minuteUTC: 0 }, internal.internal.schedule.pullMetrics, {})
crons.daily('read comments back as signals', { hourUTC: 6, minuteUTC: 0 }, internal.internal.schedule.pollComments, {})
// After the comments are read, so the brief and the problem log see this morning's.
crons.daily('morning sweep: signals, brief, problem log', { hourUTC: 6, minuteUTC: 15 }, internal.internal.schedule.morningSweep, {})
// After the sweep, so each script's last check and the writer read this morning's research.
crons.daily("write tomorrow's scripts", { hourUTC: 7, minuteUTC: 30 }, internal.internal.schedule.writeDueScripts, {})
// The review runs half an hour before planning, so next week's plan follows its pillar weights and defaults.
crons.weekly('review every strategy', STRATEGY_REVIEW_SLOT, internal.internal.schedule.reviewStrategies, {})
crons.weekly('plan next week', { dayOfWeek: 'monday', hourUTC: 7, minuteUTC: 0 }, internal.internal.schedule.planNextWeek, {})
crons.daily('age out unused signals', { hourUTC: 3, minuteUTC: 0 }, internal.internal.schedule.ageOutSignals, {})

export default crons
