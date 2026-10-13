# Influstep

The ubiquitous language of Influstep. Influstep runs AI personas that publish short videos on social platforms so that people who follow them discover Formstep. An operator sets up a persona, the persona's agents research what the audience talks about, write and record episodes on the operator's computer, publish them on schedule, and report whether followers turned into Formstep users. Each persona runs experiments so the operator learns which concepts earn attention and conversions.

This file is a glossary only: it defines what each term _is_, not how it is implemented. When several words exist for one concept, the canonical word is the heading and the rejected ones are listed under _Avoid_.

## People

**Operator**:
The person who owns an Influstep workspace, approves what personas publish, and does the few things only a human can (sign in to a tool, grant a permission, buy a license). Today the operator is the Formstep founder; later, any customer of Influstep.
_Avoid_: user (ambiguous with the viewers), admin, owner.

**Viewer**:
Someone who watches an episode on a platform. A viewer who follows the persona is a **follower**; a follower who signs up for Formstep is a **conversion**.
_Avoid_: customer (that is Formstep's relationship), audience (fine for the group, not the individual), lead.

**Sponsor**:
The product a persona promotes: Formstep. An episode either mentions the sponsor, demonstrates it, or leaves it out entirely so the persona stays interesting on its own.
_Avoid_: client, advertiser, brand (that is the persona's look).

## Personas

**Persona**:
One AI influencer profile: a name, a handle, a spoken voice (and on X a writing voice), a niche, a tone, the platforms it posts to, and a **sponsor dial** that says how often episodes carry the sponsor. A persona owns its episodes, experiments, signals, checklist, and directives. It is the unit the operator compares in reports.
_Avoid_: influencer (fine in conversation; in code and copy a persona is the profile, the agents do the work), bot, avatar (that is only the rendered face), character, creator.

**Agent**:
A worker of the workspace with one role, serving every persona. Five agents: the **researcher** polls sources for signals, the **writer** turns a concept into a script, the **producer** records the screen, voices the script, and renders the video, the **publisher** uploads on schedule and reads comments, and the **analyst** pulls metrics and decides experiments. Each takes jobs from its own queue, whichever persona they are for, and the Agents page shows what each is doing now, what waits in its queue, and what it did last. A persona hands an agent a task the way a creator briefs an assistant. An agent run is one job carried out by one role.
_Avoid_: bot, assistant, sub-agent, worker (fine in copy, "five workers serve every persona"; never as the term, since the runner and the Cloudflare Worker are the processes).

**Directive**:
An instruction the operator gives a persona in its chat ("focus on n8n error handling for two weeks", "stop mentioning pricing"). Directives are stored, dated, and read by every agent run that follows. A directive stays in force until the operator withdraws it.
_Avoid_: prompt, instruction (fine casually), note, feedback.

**Chat change**:
A change to the plan the operator asks for in a persona's chat, in plain words: replace an episode with another concept, move it to another day of its week, drop it, or give a discount code for it ("replace Tuesday's n8n episode with one about Make", "move Friday to Saturday", "drop the webhook one", "use code ADA20 for the next video"). The persona reads the message, applies the change to the episodes it may still change (from today through next week, not yet recording, uploading or live), and replies with what it did, linking the episode. A change it cannot apply (no episode matches, more than one does, the day has passed) changes nothing, and the reply says why.
_Avoid_: command, action, edit (fine casually).

**Task**:
Something the operator asks for in a persona's chat that one agent runs and answers in the same chat: a research brief (the researcher, from the persona's newest signals), a comment digest (the publisher, from the last week's comments), or an analytics summary (the analyst, from the last week's numbers). It runs as a job of the role that owns it; the persona's reply shows the job's state while it waits or runs, and the answer arrives as a message of its own.
_Avoid_: job (that is how a task runs), todo, ticket, request (Formstep's word).

**Voice** (spoken):
The persona's text-to-speech voice, set as "Voice id" in the persona's settings (`voiceId` in code: an ElevenLabs voice id in production, a mock voice locally), used for every voiced episode so the persona sounds the same across platforms.
_Avoid_: narrator, TTS (fine as the mechanism).

**Voice** (on X):
How an X persona writes, learned by the analyst from the account's imported history: the language, a summary and traits the LLM writes, the length mix and the emoji and hashtag habits counted from the account's own posts, and the example posts the writer imitates. The operator edits the language, summary and traits on the persona's voice page. Every X post is written in it; until it is learned the writer posts in English in the bible's tone. In code it is `persona.voice`; the spoken voice is always `voiceId`.
_Avoid_: style, tone (that is the persona's tone, which every platform shares), writing style.

**Sponsor dial**:
The share of a persona's episodes that carry the sponsor, as a number from 0 to 1. The planner spreads sponsored episodes across the week and keeps the first episodes of a new persona unsponsored so the profile earns followers first.
_Avoid_: ad ratio, promo rate, sponsorship level.

## Episodes

**Episode**:
One video a persona plans, records, and publishes: a concept, a hook, a script (its beats), a shot list, a recording, a render, and one publication per platform. An episode belongs to one persona, sits on one calendar day, and may carry one experiment variant.
_Avoid_: video (that is the rendered file), post (that is the publication), content, piece.

**Concept**:
The one-sentence idea of an episode ("Set up an n8n webhook that retries on failure"). A concept comes from a signal, a directive, or the persona's content pillars.
_Avoid_: topic (that is the signal's subject), idea (fine casually), title (that is the published name).

**Hook**:
The first sentence of an episode, written to keep a viewer past the first two seconds: the first sentence of a video's first beat, or a post's first line. It is read from the script, never written apart from it. Hooks are the usual unit of an experiment.
_Avoid_: intro, opener, teaser.

**Script**:
The spoken text of a video: its beats' spoken lines in order. The hook opens the first beat, the sponsor segment (when there is one) lives inside the beats, and the call to action closes the last. Written by the writer, edited by the operator beat by beat, voiced by the producer exactly as it reads.
_Avoid_: copy, narration (that is the voiced result), transcript (that is what platforms derive).

**Beat**:
One part of a video's script: what is spoken (its line) and what is shown while it is spoken (the presenter to camera, or a tool's screen at a URL). The beats are the script: the shots and the voice track are built from them, so an edit to a beat is what the recording says. The operator edits a beat's title and line; the writer chooses how many beats there are and what each shows.
_Avoid_: section, scene, segment (reserved for the sponsor segment), shot (that is the recorded piece built from a beat).

**Sponsor segment**:
Where the sponsor appears in a script, in one of three shapes: a **mention** (a sentence inside a beat: "this episode is sponsored by Formstep"), a **demo** (a beat of its own showing Formstep on screen solving the episode's problem), or **none** (no beat names it).
_Avoid_: ad read, plug, promo, placement.

**Shot**:
One recorded piece of an episode: a screen recording of a web app driven by a recipe, an avatar take of the persona speaking, or a title card. Each beat becomes one shot, the way the episode's delivery asks; the shot list orders them and the render joins them.
_Avoid_: clip (that is the file), scene, segment (reserved for the sponsor segment).

**Recipe**:
The step list a screen shot follows in the runner's browser (go to a URL, click, type, wait). Recipes run against the operator's signed-in browser profile, so a tool the persona demos must be signed in first.
_Avoid_: script (that is the spoken text), macro, scenario, test.

**Render**:
The finished video file for one aspect ratio (16:9 for YouTube, 9:16 for TikTok, Reels and Shorts), with voice and captions mixed in. One episode has one render per aspect ratio it publishes.
_Avoid_: export, output, final.

**Publication**:
One episode on one platform: the upload, its title and description, its external id, its URL, its publish time, its AI-disclosure label, and the metric snapshots taken afterwards. Its status is one of draft (waiting in a publish package), queued, uploading, live, failed, or withdrawn (its episode was killed before it went out, so it never will). A video's description off X is the persona's own text inside a footer composed when it goes out: the disclosure above, then the Formstep line, the discount code in force, and the tracked link or "Link in bio." below. On X nothing is appended: a video's text is its title, a post is its parts.
_Avoid_: post (fine in UI copy for TikTok and Instagram, never as the term), upload, release.

**Publish package**:
A rendered episode's publications waiting for the operator's approval: per platform the render it uploads, its title, the persona's own description, its publish time, and the footer composed at dispatch. The operator edits the titles and descriptions, never the footer, so an edit is never overwritten and a code change reaches every package not yet live. Approving it queues every publication and schedules the episode. A persona set to publish on its own skips the package: its rendered episodes are scheduled at once. A text post or a thread has none; its approval schedules it.
_Avoid_: bundle, preview (fine casually), draft (that is a publication's status inside the package), release.

**Episode status**:
Exactly one of: **idea** (concept only), **scripted** (script written, waiting for operator approval), **waiting on you** (a checklist item blocks it), **recording** (producer is recording shots), **rendered**, shown as "Ready to publish" (renders exist; the publish package waits for the operator's approval), **scheduled** (publications queued), **published** (every publication live), **measured** (metrics collected after the measurement window), **failed** (an agent run gave up; the error is on the episode), and **killed** (the operator withdrew it, on its page or in the chat; its publications that had not gone out are withdrawn and its queued jobs fail). Scripted episodes wait for the operator's approval before recording unless the persona is set to auto-approve, and rendered ones wait for approval of their publish package unless the persona publishes on its own. Needs approval, waiting on you and ready to publish are what "waits on you" counts; failed is counted on its own.
_Avoid_: draft (that is a publication in a package), in progress, done, live (that is a publication), pending.

**Measurement window**:
The time after publishing (72 hours by default) during which the analyst snapshots metrics before marking an episode measured and feeding its experiment.
_Avoid_: attribution window (that is for conversions), cooldown.

## Research

**Signal**:
One thing the researcher found worth reacting to: a Hacker News story, a Reddit thread, a Google trend, a comment under one of the persona's publications, or a competitor's video. A signal has a source, a title, a URL, a score, topics, and the episodes it fed. Signals age out after two weeks unless an episode used them.
_Avoid_: trend (that is one source), post, item, insight, topic (that is a tag on a signal).

**Source**:
Where signals come from: `hackernews`, `reddit`, `google_trends`, `comments`, `youtube_search`. Each source is a provider with a mock and a real adapter.
_Avoid_: feed, channel (that is a platform account), integration.

**Content pillar**:
One of three to five recurring subjects a persona always returns to ("n8n tutorials", "AI agent workflows", "automation fails"). Pillars keep a persona consistent; signals decide which pillar an episode draws from this week.
_Avoid_: category, theme, niche (that is the whole persona's field), series.

## Experiments

**Experiment**:
A question a persona tests across its episodes ("Do 'I was wrong about…' hooks beat 'How to…' hooks on click rate?"): a hypothesis, a metric, two or more variants, and a decision rule. Episodes are assigned a variant at planning time; the analyst compares variants after each measurement window.
_Avoid_: A/B test (fine in conversation), split test, campaign, trial.

**Variant**:
One arm of an experiment, with a key and a description the writer follows. The **control** is the variant the persona used before.
_Avoid_: option, arm (fine in statistics), treatment, version.

**Metric**:
What an experiment or report measures: `views`, `watch_rate`, `follows`, `clicks`, `signups`, `paid`. Views, watch rate, and follows come from the platforms; clicks from tracked links; signups and paid from PostHog.
_Avoid_: KPI, goal, stat.

**Decision**:
The analyst's verdict on an experiment once a variant leads with enough confidence: which variant won, by how much, and what the persona does next. The operator can override it.
_Avoid_: result, winner (fine in copy), outcome.

## Attribution

**Tracked link**:
A short link (`/go/<slug>`) that a publication carries in its description, bio, or pinned comment. The worker counts each click and redirects to Formstep with UTM parameters naming the persona, the episode, and the platform, so PostHog can tie a signup back to the episode.
_Avoid_: affiliate link, UTM link, short URL, redirect.

**Link in bio**:
The one page per persona (`/p/<handle>`) that platforms without clickable descriptions point to. It lists the persona's latest episodes and the sponsor's tracked link.
_Avoid_: landing page, profile page, hub.

**Conversion**:
A Formstep event tied to a persona by UTM: a signup, a first published form, or a paid subscription. Conversions reach Influstep from PostHog.
_Avoid_: sale, lead, goal (that is PostHog's word).

**Report**:
The one page per persona that answers "is this persona working?": followers, views, clicks, signups, and paid over time, the funnel from view to paid, and the open experiments. Kept to one screen; detail lives in the episode list.
_Avoid_: dashboard (fine casually), analytics (that is the data), insights.

## Operations

**Checklist item**:
Something only the operator can do, created by an agent when it is blocked: what to do, why, which episode it unblocks, and a button that performs it when the runner can help (open the runner's browser for a sign-in). Done items unblock their episode.
_Avoid_: todo, task (that is a chat request an agent answers), ticket, request (Formstep's word).

**Runner**:
The Node process on the operator's computer that records screens, calls the voice and avatar providers, renders videos, and uploads to platforms. It polls the backend for jobs, keeps a signed-in browser profile, and writes artifacts back. There is one runner per operator machine.
_Avoid_: worker (that is the Cloudflare Worker serving the app), daemon (fine casually), agent (that is a role), bot.

**Job**:
One unit of work a cron, an agent, or the operator queued: a kind, a payload, the role that owns it, where it runs (`backend` or `runner`), and a status (`queued`, `running`, `done`, `failed`). Jobs are the audit trail of what a persona did.
_Avoid_: task (that is the chat request a job of its kind answers), action, run (an agent run is one job's execution), step.

**Provider**:
An external capability behind an interface with a mock and a real adapter: `llm`, `voice`, `avatar`, `publisher` (one per platform), `signals` (one per source), `analytics` (PostHog). The provider mode is chosen explicitly per deployment; nothing falls back to mock when a key is missing.
_Avoid_: integration, service, plugin, connector.

**Plan**:
The persona's calendar for the coming week: which episodes on which days, which variant each carries, which carry the sponsor. The planner job writes it; the operator edits it on the calendar or with a chat change.
_Avoid_: schedule (that is the publish time), roadmap, queue.

**Pause**:
The operator's kill switch on a persona: nothing records, publishes, or replies until the persona is resumed. Scheduled publications wait; nothing is lost.
_Avoid_: disable, stop, archive, mute.
