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
| llm             | template writer seeded by ids                 | Anthropic Messages API (`claude-opus-5-5`)                        | `ANTHROPIC_API_KEY`                                   |
| voice           | silent track with the script length           | ElevenLabs text-to-speech, persona voice id                        | `ELEVENLABS_API_KEY`; commercial use needs a paid plan |
| avatar          | title card with the persona's name            | HeyGen or Higgsfield talking-head take                             | key; pick one once the look is chosen                |
| screen          | ffmpeg placeholder video                      | Playwright `recordVideo` against the runner's browser profile      | the tool signed in (checklist item)                  |
| publisher       | fake external id and URL                      | YouTube Data API (resumable upload), TikTok Content Posting, Instagram Graph (Reels) | OAuth apps; TikTok and Instagram need app review |
| signals         | fixed set of plausible stories                | Hacker News Algolia (no key), Reddit public JSON (no key), Google Trends (unofficial), YouTube search | none for HN and Reddit |
| comments        | generated comments                            | YouTube commentThreads, TikTok comment list, Instagram comments    | same OAuth apps                                      |
| analytics       | seeded conversions proportional to clicks     | PostHog query API (HogQL on `$initial_utm_*`)                      | `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_HOST` |

Set `PROVIDERS_MODE=real` on the backend and the runner to switch; each adapter throws naming its missing key.

## v0.2: autonomy and value

Written 2026-10-10 after the operator's second brief. The product in one sentence: highly customizable personas, each with shared agents it directs, that evolve on their own data into creators who bring Formstep paying customers. The question every screen must answer: did a video move Formstep? Built in this order, each slice shipped on its own.

1. **Value per episode.** Conversions cover the whole Formstep journey: demo started, signup, trial started, paid. Each one records whether it came through a tracked link (UTM) or a discount code. Codes are the operator's: created in Polar by hand and handed to a persona in chat ("use code ADA20 for the next video") or in its settings; a persona never mints one. Influstep puts the code in descriptions and counts its redemptions. The workspace holds a value per paid conversion, so the report can estimate what a persona and an episode earned. Every publication's description carries the Formstep line, the code when there is one, the tracked link and the AI disclosure, whatever the sponsor segment says about the video itself.
2. **Preview before publish.** A rendered episode waits as a publish package (video per aspect, per-platform title and description, time) until the operator approves it, unless the persona is set to publish on its own.
3. **Chat that changes the plan.** "Replace Tuesday's n8n episode with one about Make", "move Friday to Saturday", "drop the webhook one": the persona interprets, applies, and says what it did. Agent tasks from the same chat: a research brief, a comment digest, an analytics summary, each run by the role that owns it and posted back as a message. Agents are workers of the workspace, not of one persona: one researcher, writer, producer, publisher, analyst serve every persona, each with a queue the operator can see on an Agents page (what each worker is doing now, for whom, what it did last), and a persona tasks a worker the way a creator would brief an assistant.
4. **Strategy review.** The analyst reviews each persona weekly: pillar weights, publish hour per platform, and which experiment to run next. Every change has a reason and evidence and shows up in the persona's journal; the planner follows the current strategy. The persona picks its own experiments from a catalog of strategies (hook style, concept, sponsor placement, publish time, description format, episode length, call to action), preferring the dimension it knows least about, the metric closest to the goal (paid over signups over clicks over views), and never more than one running experiment per persona. When an experiment decides, the winner becomes the persona's default for that dimension (the hook style it opens with, the hour it posts at, the description format), the decision is written to memory as a learning with the experiment as evidence, and the writer reads that learning before the next script. A winner that later data contradicts is re-tested, not trusted forever.
5. **Fresh research, like a real creator.** A persona works the way a working creator does: before it decides what to record it goes online. Search suggestions join the signal sources, so episodes answer what people type. Every signal carries a freshness score that decays by the day, and the researcher runs a morning sweep per persona that writes a short daily brief to memory (what moved in the last 24 hours across forums, search, trends, and the persona's own comments) and expires it the next day. Scripts are written just in time, the day before the publish slot, not when the week is planned, and the writer asks the researcher for a last check ("is this still what people ask?") before it writes; a concept that went cold is swapped for the day's strongest signal and the journal says so. Problems the persona meets itself (a tool that broke in a recording, a question repeated under its videos) become a problem log in memory, and a logged problem is a concept candidate with a high score. Experiment kinds for publish time and description format (code versus link) ship in the same slice.
6. **Memory and assets.** Each persona keeps a memory: short entries the persona and its agents write and read, each with a kind (learning, fact, rule, goal note), the evidence it rests on (episode, experiment, signal, or the operator's message), a confidence, and a status (active, superseded). The writer reads active entries with the bible and the directives before every script; the strategy review reads them before it changes anything and writes a new learning for every change it makes; the chat can store one ("remember that viewers hate the word 'guys'"). Entries that later data contradicts are superseded, never deleted, so the persona can show why it believes something. The workspace holds the one goal every persona optimizes for, paying Formstep customers, and each strategy review records where the persona stands against it (value this window, trend, what it will try next). Each persona also has an asset library in Convex storage: images, clips, audio, documents, uploaded by the operator or saved by the producer (renders, voice tracks, title cards), each with tags and a note; the writer can ask for an asset in a shot ("show the pricing screenshot") and the producer places it.
7. **Analytics, top down.** Reports open on the workspace: one funnel for every persona together (views, follows, clicks, demos, signups, trials, paid, value) for the window, an engagement line (likes, comments, watch rate, follows per view), and a persona table with the same columns so the operator sees in one glance who brings paying customers and who only brings views. One click drills into a persona (the existing report), one more into an episode (the value block). Every number keeps its provenance: platform counts, exact clicks and redemptions, attributed PostHog conversions. Three "what works" lists computed from measured episodes across personas: by pillar, by hook style, by sponsor segment, each ranked by value then clicks per view, so the operator and the strategy review read the same facts.
8. **Onboarding.** A first-run flow that builds the roster instead of a blank form: how many personas, then one step per persona. Each step asks for the niche and the audience, proposes a name, handle, tone, pillars and a bible the operator edits in place, and asks for the look: a style (cartoon presenter, photoreal presenter, or screen-only with a voice, Loom-style with a small corner avatar), reference images or a short reference video uploaded to the asset library, and a voice (an ElevenLabs voice id, or a description the voice provider turns into one). The look becomes the persona's appearance profile; the avatar provider reads it for every take (mock renders a title card in the chosen style until a provider key exists). The flow ends with the platforms and the format for each one, the sponsor dial and the posting hours, then plans the first week. The same flow adds one more persona later.
9. **Platform specialists.** A persona publishes only where it is set to publish. The roster can hold a TikTok-only persona, a YouTube specialist, and one that posts everywhere, and nothing is ever queued for a platform a persona does not have. Each persona carries a format per platform it uses: target length (a 30-second TikTok, an eight-minute YouTube tutorial), aspect, delivery (talking head, screen recording with a corner avatar, screen only), and a hook convention. Onboarding starts from per-platform defaults the operator edits (TikTok: 20 to 45 seconds, vertical, hook in the first two seconds; YouTube: 3 to 10 minutes, wide, a screen tutorial with chapters, plus a Short cut when the format asks for one; Instagram: 30 to 60 seconds, vertical). Every agent reads the format: the writer writes to the length and the delivery, the producer records only the cuts that persona's platforms need, publish-time defaults and experiments are per platform, and the report compares a persona against its own platforms, so a YouTube specialist is judged on watch time and tutorials and a TikTok specialist on hooks and shares, not on the same bar.
10. **Home dashboard.** The calendar stays the plan for the week; above it a short overview answers the operator's three questions in one glance: what waits on me (checklist and approvals), what the personas changed on their own this week (journal), and what it earned (value per persona for the window, with the attribution caveat). One screen, no widget grid.
11. **Polish.** An impeccable pass (critique, then polish) over every screen against DESIGN.md, then the cleanup skill over the changed files. Smoke test in Chrome at desktop and phone width.

### Autonomy loop

What runs on its own, per unpaused persona:

| When                 | Job                   | Role       | Writes                                      |
| -------------------- | --------------------- | ---------- | ------------------------------------------- |
| hourly               | poll_signals          | researcher | signals                                     |
| daily 05:00 UTC      | pull_metrics          | analyst    | snapshots, conversions, redemptions         |
| daily 05:00 UTC      | evaluate_experiments  | analyst    | decisions, journal                          |
| daily 06:00 UTC      | poll_comments         | publisher  | comment signals                             |
| Monday 07:00 UTC     | plan_week             | writer     | next week's ideas, then scripts             |
| Monday 07:30 UTC     | review_strategy       | analyst    | strategy changes, memory, journal, experiments |
| every 5 minutes      | dispatch publications | publisher  | runner jobs for due publications            |

The operator only ever: approves scripts (unless the persona auto-approves), approves publish packages (unless the persona publishes on its own), signs in to tools, sets provider keys, hands over discount codes, and talks to the persona.

### What Formstep must emit

Influstep reads Formstep's PostHog project. Today Formstep sends only `signed_up` from the server (with `$identify` to the landing visitor). For the full funnel Formstep must send these events with the person's `$initial_utm_*` properties intact:

| Event                  | When                                         | Properties                                      |
| ---------------------- | -------------------------------------------- | ----------------------------------------------- |
| `demo_started`         | the visitor opens /try and sends a request   | `demo`                                          |
| `signed_up`            | account created (exists)                     | `provider`, `app`                               |
| `trial_started`        | Pro trial begins                             | `plan`                                          |
| `subscription_started` | first successful payment                     | `plan`, `interval`, `discount_code`, `order_id` |

A purchase made with a persona's code reaches Influstep twice, from PostHog and from Polar. Polar is the exact source for those, so the analyst drops the PostHog copy when `discount_code` names a code Influstep handed out; `order_id` (the Polar order) lets it match the two rows outright once Formstep sends it.

Two caveats the report states on screen. PostHog on formstep.io is opt-out by default behind a consent banner, so UTM-attributed numbers undercount; tracked-link clicks and discount-code redemptions are exact and consent-independent. Attribution is first touch.

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
- **Attribution is first-touch.** Good for comparing variants, weak for absolute numbers. The report labels them "Signups" and says under every conversion count that they are first-touch and undercount.
