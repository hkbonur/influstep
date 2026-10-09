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
crons.weekly('plan next week', { dayOfWeek: 'monday', hourUTC: 7, minuteUTC: 0 }, internal.internal.schedule.planNextWeek, {})
crons.daily('age out unused signals', { hourUTC: 3, minuteUTC: 0 }, internal.internal.schedule.ageOutSignals, {})

export default crons
