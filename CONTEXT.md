# Influstep

The ubiquitous language of Influstep — Influstep runs AI personas that publish short videos on social platforms so that people who follow them discover Formstep. An operator sets up a persona, the persona's agents research what the audience talks about, write and record episodes on the operator's computer, publish them on schedule, and report whether followers turned into Formstep users. Each persona runs experiments so the operator learns which concepts earn attention and conversions.

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
One AI influencer profile: a name, a handle, a voice, a niche, a tone, the platforms it posts to, and a **sponsor dial** that says how often episodes carry the sponsor. A persona owns its episodes, experiments, signals, checklist, and directives. It is the unit the operator compares in reports.
_Avoid_: influencer (fine in conversation; in code and copy a persona is the profile, the agents do the work), bot, avatar (that is only the rendered face), character, creator.

**Agent**:
One role a persona's work is split into. Five roles: the **researcher** polls sources for signals, the **writer** turns a concept into a script, the **producer** records the screen, voices the script, and renders the video, the **publisher** uploads on schedule and reads comments, and the **analyst** pulls metrics and decides experiments. An agent run is one job carried out by one role.
_Avoid_: bot, worker (that is the runner process), assistant, sub-agent.

**Directive**:
An instruction the operator gives a persona in its chat ("focus on n8n error handling for two weeks", "stop mentioning pricing"). Directives are stored, dated, and read by every agent run that follows. A directive stays in force until the operator withdraws it.
_Avoid_: prompt, instruction (fine casually), note, feedback.

**Voice**:
The persona's text-to-speech voice (an ElevenLabs voice id in production, a mock voice locally), used for every voiced episode so the persona sounds the same across platforms.
_Avoid_: narrator, TTS (fine as the mechanism).

**Sponsor dial**:
The share of a persona's episodes that carry the sponsor, as a number from 0 to 1. The planner spreads sponsored episodes across the week and keeps the first episodes of a new persona unsponsored so the profile earns followers first.
_Avoid_: ad ratio, promo rate, sponsorship level.

## Episodes

**Episode**:
One video a persona plans, records, and publishes: a concept, a hook, a script, a shot list, a recording, a render, and one publication per platform. An episode belongs to one persona, sits on one calendar day, and may carry one experiment variant.
_Avoid_: video (that is the rendered file), post (that is the publication), content, piece.

**Concept**:
The one-sentence idea of an episode ("Set up an n8n webhook that retries on failure"). A concept comes from a signal, a directive, or the persona's content pillars.
_Avoid_: topic (that is the signal's subject), idea (fine casually), title (that is the published name).

**Hook**:
The first sentence of an episode, written to keep a viewer past the first two seconds. Hooks are the usual unit of an experiment.
_Avoid_: intro, opener, teaser.

**Script**:
The spoken text of an episode in sections: hook, body, sponsor segment (optional), call to action. Written by the writer, edited by the operator, voiced by the producer.
_Avoid_: copy, narration (that is the voiced result), transcript (that is what platforms derive).

**Sponsor segment**:
The part of a script where the sponsor appears, in one of three shapes: a **mention** ("this episode is sponsored by Formstep"), a **demo** (a screen recording of Formstep solving the episode's problem), or **none**.
_Avoid_: ad read, plug, promo, placement.

**Shot**:
One recorded piece of an episode: a screen recording of a web app driven by a recipe, an avatar take of the persona speaking, or a title card. The shot list orders them; the render joins them.
_Avoid_: clip (that is the file), scene, segment (reserved for the sponsor segment).

**Recipe**:
The step list a screen shot follows in the runner's browser (go to a URL, click, type, wait). Recipes run against the operator's signed-in browser profile, so a tool the persona demos must be signed in first.
_Avoid_: script (that is the spoken text), macro, scenario, test.

**Render**:
The finished video file for one aspect ratio (16:9 for YouTube, 9:16 for TikTok, Reels and Shorts), with voice and captions mixed in. One episode has one render per aspect ratio it publishes.
_Avoid_: export, output, final.

**Publication**:
One episode on one platform: the upload, its external id, its URL, its publish time, its AI-disclosure label, and the metric snapshots taken afterwards.
_Avoid_: post (fine in UI copy for TikTok and Instagram, never as the term), upload, release.

**Episode status**:
Exactly one of: **idea** (concept only), **scripted** (script written, waiting for operator approval), **waiting on you** (a checklist item blocks it), **recording** (producer is recording shots), **rendered** (renders exist, waiting for publish time), **scheduled** (publications queued), **published** (every publication live), **measured** (metrics collected after the measurement window), **failed** (an agent run gave up; the error is on the episode), and **killed** (the operator withdrew it). Scripted episodes wait for the operator's approval before recording unless the persona is set to auto-approve.
_Avoid_: draft, in progress, done, live, pending.

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
A task only the operator can do, created by an agent when it is blocked: what to do, why, which episode it unblocks, and a button that performs it when the runner can help (open the runner's browser for a sign-in). Done items unblock their episode.
_Avoid_: todo, task (collides with agent runs), ticket, request (Formstep's word).

**Runner**:
The Node process on the operator's computer that records screens, calls the voice and avatar providers, renders videos, and uploads to platforms. It polls the backend for jobs, keeps a signed-in browser profile, and writes artifacts back. There is one runner per operator machine.
_Avoid_: worker (that is the Cloudflare Worker serving the app), daemon (fine casually), agent (that is a role), bot.

**Job**:
One unit of work a cron, an agent, or the operator queued: a kind, a payload, the role that owns it, where it runs (`backend` or `runner`), and a status (`queued`, `running`, `done`, `failed`). Jobs are the audit trail of what a persona did.
_Avoid_: task, action, run (an agent run is one job's execution), step.

**Provider**:
An external capability behind an interface with a mock and a real adapter: `llm`, `voice`, `avatar`, `publisher` (one per platform), `signals` (one per source), `analytics` (PostHog). The provider mode is chosen explicitly per deployment; nothing falls back to mock when a key is missing.
_Avoid_: integration, service, plugin, connector.

**Plan**:
The persona's calendar for the coming week: which episodes on which days, which variant each carries, which carry the sponsor. The planner job writes it; the operator edits it on the calendar.
_Avoid_: schedule (that is the publish time), roadmap, queue.

**Pause**:
The operator's kill switch on a persona: nothing records, publishes, or replies until the persona is resumed. Scheduled publications wait; nothing is lost.
_Avoid_: disable, stop, archive, mute.
