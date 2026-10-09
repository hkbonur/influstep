# Influstep: plan

Written 2026-10-09. The goal: Formstep gets attention and users through AI personas the operator owns, instead of ads or paid influencers. Later, the same software as a product for other companies.

## How a persona works

A persona is a profile (name, handle, voice, niche, tone, platforms, content pillars, sponsor dial). Five agent roles do its work, each as jobs the operator can see:

| Role       | Runs on          | What it does                                                                                                 |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| researcher | backend (hourly) | Polls Hacker News, Reddit, Google Trends, YouTube search, and the persona's own comments. Stores signals with topics and a score. |
| writer     | backend          | Plans the week (which concept on which day, which experiment variant, sponsored or not), writes the script from a signal or a pillar and the open directives. |
| producer   | runner           | Records screen shots with Playwright recipes in the operator's signed-in browser, generates the voice, renders 16:9 and 9:16 with captions. |
| publisher  | runner + backend | Uploads at the scheduled time with the tracked link and the AI-disclosure label, then reads comments back as signals. |
| analyst    | backend (daily)  | Snapshots platform metrics, clicks, and PostHog conversions; decides experiments; writes the report.           |

An episode moves through: idea → scripted → (waiting on you) → recording → rendered → scheduled → published → measured, or failed / killed. Scripts wait for the operator's approval unless the persona auto-approves.

When an agent cannot continue (n8n not signed in, YouTube permission missing), it creates a checklist item that names the episode it unblocks. Items with a runner action ("Open the runner's browser to sign in") carry a button.

## What is built (v0.1, local, mock providers)

- `packages/shared`: episode status machine, job kinds, provider contracts, UTM and slug helpers, experiment statistics.
- `packages/convex`: schema; core rules (pipeline transitions, weekly planner, experiment decision, attribution); operator API; agent actions; job dispatch with a runner HTTP route; crons; providers (mock + real where no key is needed); seed.
- `apps/studio`: Calendar (home), Personas (chat with directives, script editor with approval, checklist, settings), Experiments, Signals, Checklist, Reports (funnel + trend per persona), Providers; Worker with `/go/:slug` and `/p/:handle`.
- `apps/runner`: polls jobs; mock producer renders a placeholder video with ffmpeg; real producer records with Playwright `recordVideo`; uploads to Convex storage; heartbeats.
- Tests: pipeline, planner, experiment statistics, attribution, worker routes.

## What is mocked and how to make it real

| Provider        | Mock                                          | Real adapter                                                       | Needs                                                |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| llm             | template writer seeded by ids                 | Anthropic Messages API (`claude-sonnet-5-5`)                        | `ANTHROPIC_API_KEY`                                   |
| voice           | silent track with the script length           | ElevenLabs text-to-speech, persona voice id                        | `ELEVENLABS_API_KEY`; commercial use needs a paid plan |
| avatar          | title card with the persona's name            | HeyGen or Higgsfield talking-head take                             | key; pick one once the look is chosen                |
| screen          | ffmpeg placeholder video                      | Playwright `recordVideo` against the runner's browser profile      | the tool signed in (checklist item)                  |
| publisher       | fake external id and URL                      | YouTube Data API (resumable upload), TikTok Content Posting, Instagram Graph (Reels) | OAuth apps; TikTok and Instagram need app review |
| signals         | fixed set of plausible stories                | Hacker News Algolia (no key), Reddit public JSON (no key), Google Trends (unofficial), YouTube search | none for HN and Reddit |
| comments        | generated comments                            | YouTube commentThreads, TikTok comment list, Instagram comments    | same OAuth apps                                      |
| analytics       | seeded conversions proportional to clicks     | PostHog query API (HogQL on `$initial_utm_*`)                      | `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_HOST` |

Set `PROVIDERS_MODE=real` on the backend and the runner to switch; each adapter throws naming its missing key.

## Ideas beyond the request

1. **One recording, three cuts.** Record once at 16:9, derive 9:16 and 1:1 with a camera path that follows the cursor (the Formstep explainer already does this in code). Saves a recording per platform.
2. **Hook as the experiment unit.** Most of the lift on short video is the first two seconds. Experiments default to hook variants; concept variants are a second kind.
3. **Comment-reply agent.** The publisher answers comments in the persona's voice, with a directive-controlled allow list of topics, and escalates anything about pricing or bugs to the checklist.
4. **Best time to post.** The analyst learns per platform and per persona when views peak and the planner schedules there.
5. **Persona consistency file.** Each persona keeps a short "bible" (how it speaks, what it never says, recurring phrases). The writer reads it with the directives, so a persona stays the same voice across months.
6. **Search intent, not just trends.** The researcher also pulls "People also ask" and autocomplete for the persona's pillars, so episode titles match what people type.
7. **Evergreen vs reactive mix.** The planner keeps two of five episodes reactive (from this week's signals) and three evergreen (pillars), so a persona ranks over time and still rides news.
8. **Sponsor ramp.** New personas start at sponsor dial 0 for the first ten episodes, then ramp to the configured dial. Already in the planner.
9. **Kill switch and quiet hours.** Pause per persona, plus a global quiet window where nothing publishes (holidays, incidents).
10. **Disclosure by default.** Every publication carries the platform's AI-generated label and the sponsorship disclosure in the first line of the description. EU AI Act and FTC both expect it.
11. **Cross-persona learning.** When an experiment is decided for one persona, the analyst proposes the same experiment to the others as a checklist item.
12. **Runner on a cloud VM.** The runner interface does not assume macOS; a Linux VM with Chromium and ffmpeg can take over recording for tools that do not need the operator's sessions.
13. **Multi-tenant later.** Personas already belong to a workspace. Auth (Better Auth, as in Formstep), billing, and per-workspace provider keys turn Influstep into a product.

## Risks worth knowing

- **Platform API access.** TikTok Content Posting and Instagram publishing need app review and a business account; YouTube uploads cost 1,600 of the 10,000 daily quota units, so about six uploads a day per project.
- **Platform policy on AI personas.** YouTube and TikTok allow AI-generated content with labels; undisclosed synthetic people can be removed. The disclosure defaults exist for this.
- **Voice licensing.** ElevenLabs free-tier audio cannot be used commercially even after upgrading; generate on a paid plan from the start.
- **Attribution is first-touch.** Good for comparing variants, weak for absolute numbers. The report says "attributed signups" rather than "signups".
