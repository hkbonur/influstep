import { PLATFORMS, POLLED_SIGNAL_SOURCES, type PolledSignalSource } from '@influstep/shared'
import { query } from '../_generated/server'
import { latestRunner } from '../core/jobs'
import { hasEnv, providersMode } from '../lib/env'
import { platformHasRealAdapter } from '../providers/comments'
import { signalSourceHasRealAdapter } from '../providers/signals'

/**
 * What each polled signal source's real adapter reads. Comments come from the
 * platform providers below and problems from the problem log, so neither is a
 * signal provider of its own.
 */
const SIGNAL_SOURCE_REAL: Record<PolledSignalSource, string> = {
  hackernews: 'HN Algolia',
  reddit: 'Reddit JSON',
  google_trends: 'none yet',
  youtube_search: 'none yet',
  search: 'Google autocomplete (unofficial)',
}

/** The Providers page: what runs mock, what runs real, which keys are set, and whether the runner is alive. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const mode = providersMode()
    const runner = await latestRunner(ctx)
    const recentJobs = await ctx.db.query('jobs').order('desc').take(30)
    return {
      mode,
      keys: {
        ANTHROPIC_API_KEY: hasEnv('ANTHROPIC_API_KEY'),
        POSTHOG_API_KEY: hasEnv('POSTHOG_API_KEY'),
        POSTHOG_PROJECT_ID: hasEnv('POSTHOG_PROJECT_ID'),
        POSTHOG_HOST: hasEnv('POSTHOG_HOST'),
        POLAR_API_BASE: hasEnv('POLAR_API_BASE'),
        POLAR_ACCESS_TOKEN: hasEnv('POLAR_ACCESS_TOKEN'),
        POLAR_ORGANIZATION_ID: hasEnv('POLAR_ORGANIZATION_ID'),
        YOUTUBE_API_KEY: hasEnv('YOUTUBE_API_KEY'),
        OPENAI_API_KEY: hasEnv('OPENAI_API_KEY'),
        ARK_API_KEY: hasEnv('ARK_API_KEY'),
        ARK_BASE_URL: hasEnv('ARK_BASE_URL'),
        SEEDANCE_MODEL: hasEnv('SEEDANCE_MODEL'),
        RUNNER_TOKEN: hasEnv('RUNNER_TOKEN'),
      },
      providers: [
        { name: 'llm', real: 'Anthropic Messages API', hasReal: true, needs: ['ANTHROPIC_API_KEY'] },
        { name: 'analytics', real: 'PostHog HogQL', hasReal: true, needs: ['POSTHOG_API_KEY', 'POSTHOG_PROJECT_ID', 'POSTHOG_HOST'] },
        {
          name: 'discounts',
          real: 'Polar (reads)',
          hasReal: true,
          needs: ['POLAR_API_BASE', 'POLAR_ACCESS_TOKEN', 'POLAR_ORGANIZATION_ID'],
        },
        ...POLLED_SIGNAL_SOURCES.map((source) => ({
          name: `signals: ${source}`,
          real: SIGNAL_SOURCE_REAL[source],
          hasReal: signalSourceHasRealAdapter(source),
          needs: [] as string[],
        })),
        ...PLATFORMS.map((platform) => ({
          name: `platform: ${platform}`,
          real: platform === 'youtube' ? 'YouTube Data API (reads)' : 'none yet',
          hasReal: platformHasRealAdapter(platform),
          needs: platform === 'youtube' ? ['YOUTUBE_API_KEY'] : [],
        })),
        {
          name: 'media',
          real: 'gpt-image-1 stills, Seedance clips',
          hasReal: true,
          needs: ['OPENAI_API_KEY', 'ARK_API_KEY', 'ARK_BASE_URL', 'SEEDANCE_MODEL'],
        },
        { name: 'engagement', real: 'X API recent search and reply counts', hasReal: false, needs: [] as string[] },
        { name: 'voice', real: 'ElevenLabs (runner)', hasReal: false, needs: ['ELEVENLABS_API_KEY'] },
        // The runner's key (HEYGEN_API_KEY in apps/runner/.env.local); the backend cannot see it.
        { name: 'avatar', real: 'HeyGen Avatar IV (runner)', hasReal: true, needs: [] as string[] },
        { name: 'publisher', real: 'YouTube upload (runner)', hasReal: false, needs: [] as string[] },
      ],
      // Whether it is alive is judged in the studio against its own clock (shared runnerAlive); a query would not notice it go silent.
      runner,
      recentJobs,
    }
  },
})
