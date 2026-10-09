import { PLATFORMS, SIGNAL_SOURCES } from '@influstep/shared'
import { query } from '../_generated/server'
import { hasEnv, providersMode } from '../lib/env'
import { platformHasRealAdapter } from '../providers/comments'
import { signalSourceHasRealAdapter } from '../providers/signals'

const RUNNER_STALE_MS = 2 * 60_000

/** The Providers page: what runs mock, what runs real, which keys are set, and whether the runner is alive. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const mode = providersMode()
    const runners = (await ctx.db.query('runners').collect()).sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    const runner = runners[0] ?? null
    const recentJobs = await ctx.db.query('jobs').order('desc').take(30)
    return {
      mode,
      keys: {
        ANTHROPIC_API_KEY: hasEnv('ANTHROPIC_API_KEY'),
        POSTHOG_API_KEY: hasEnv('POSTHOG_API_KEY'),
        POSTHOG_PROJECT_ID: hasEnv('POSTHOG_PROJECT_ID'),
        POSTHOG_HOST: hasEnv('POSTHOG_HOST'),
        YOUTUBE_API_KEY: hasEnv('YOUTUBE_API_KEY'),
        RUNNER_TOKEN: hasEnv('RUNNER_TOKEN'),
      },
      providers: [
        { name: 'llm', real: 'Anthropic Messages API', hasReal: true, needs: ['ANTHROPIC_API_KEY'] },
        { name: 'analytics', real: 'PostHog HogQL', hasReal: true, needs: ['POSTHOG_API_KEY', 'POSTHOG_PROJECT_ID', 'POSTHOG_HOST'] },
        ...SIGNAL_SOURCES.map((source) => ({
          name: `signals: ${source}`,
          real: source === 'hackernews' ? 'HN Algolia' : source === 'reddit' ? 'Reddit JSON' : 'none yet',
          hasReal: signalSourceHasRealAdapter(source),
          needs: [] as string[],
        })),
        ...PLATFORMS.map((platform) => ({
          name: `platform: ${platform}`,
          real: platform === 'youtube' ? 'YouTube Data API (reads)' : 'none yet',
          hasReal: platformHasRealAdapter(platform),
          needs: platform === 'youtube' ? ['YOUTUBE_API_KEY'] : [],
        })),
        { name: 'voice', real: 'ElevenLabs (runner)', hasReal: false, needs: ['ELEVENLABS_API_KEY'] },
        { name: 'avatar', real: 'HeyGen or Higgsfield (runner)', hasReal: false, needs: [] as string[] },
        { name: 'publisher', real: 'YouTube upload (runner)', hasReal: false, needs: [] as string[] },
      ],
      runner: runner ? { ...runner, alive: Date.now() - runner.lastSeenAt < RUNNER_STALE_MS } : null,
      recentJobs,
    }
  },
})
