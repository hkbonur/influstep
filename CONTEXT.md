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

**Onboarding**:
The flow that builds the roster (`/onboarding`): how many personas, then one step per persona. The operator names a niche and an audience, the writer proposes a name, handle, tone, pillars, bio and bible, the operator edits them in place and gives the look and the voice, picks the platforms with their formats, the videos a week and the sponsor dial; creating the persona plans the rest of this week and next week. A first run, with no persona yet, starts here, and it makes the workspace when nobody ran the seed. The sidebar's + runs the same flow for one more persona.
_Avoid_: wizard, setup, signup.

**Agent**:
A worker of the workspace with one role, serving every persona. Five agents: the **researcher** polls sources for signals, writes each persona's morning brief and problem log, and gives each script a last check; the **writer** turns a concept into a script; the **producer** records the screen, voices the script, and renders the video; the **publisher** uploads on schedule and reads comments; and the **analyst** pulls metrics, decides experiments, and reviews each persona's strategy every week. Each takes jobs from its own queue, whichever persona they are for, and the Agents page shows what each is doing now, what waits in its queue, and what it did last. A persona hands an agent a task the way a creator briefs an assistant. An agent run is one job carried out by one role.
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
The persona's text-to-speech voice, set as "Voice id" in the persona's settings (`voiceId` in code: an ElevenLabs voice id in production, a mock voice locally), used for every voiced episode so the persona sounds the same across platforms. At onboarding the operator gives an id or describes the voice; a description is made into a voice by the voice provider on the runner (ElevenLabs Voice Design), and until it is made no video of the persona can be approved for recording.
_Avoid_: narrator, TTS (fine as the mechanism).

**Look**:
How a persona appears in its videos: a presenter style (cartoon presenter, photoreal presenter, Loom-style presenter, or screen only, with a voice and no presenter) and the reference pictures or clips of it in its asset library, tagged reference. A Loom-style presenter sits in a round bubble in a corner of the screen the whole video, and the operator picks whether its face is a cartoon or realistic. The first reference image is the **portrait**, the face every avatar take is animated from: uploaded, or drawn by the media provider from the operator's description of the presenter. The avatar provider (HeyGen) animates the portrait to the persona's own voice track; in mock mode a take is a card with the portrait. A persona with no presenter records the screen only on every platform, and a Loom-style one records Screen with avatar on every platform. `appearance` in code.
_Avoid_: avatar (that is the rendered take), skin, theme.

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

**Just-in-time script**:
The rule that a script, or a post's text, is written the day before the episode goes out, not when the week is planned, so the writer reads that morning's brief and problems first. Planning leaves ideas; an idea for today or tomorrow is written at once, a later one waits for its day, and an idea whose day passed unwritten fails. Before writing, the researcher gives it a last check.
_Avoid_: lazy script, late script, draft (that is a publication in a package).

**Beat**:
One part of a video's script: what is spoken (its line) and what is shown while it is spoken (the presenter to camera, a tool's screen at a URL, or an asset from the persona's library). The beats are the script: the shots and the voice track are built from them, so an edit to a beat is what the recording says. The operator edits a beat's title and line; the writer chooses how many beats there are and what each shows.
_Avoid_: section, scene, segment (reserved for the sponsor segment), shot (that is the recorded piece built from a beat).

**Sponsor segment**:
Where the sponsor appears in a script, in one of three shapes: a **mention** (a sentence inside a beat: "this episode is sponsored by Formstep"), a **demo** (a beat of its own showing Formstep on screen solving the episode's problem), or **none** (no beat names it).
_Avoid_: ad read, plug, promo, placement.

**Shot**:
One recorded piece of an episode: a screen recording of a web app driven by a recipe, an avatar take of the persona speaking, a title card, or an asset held on screen (an image as a still, a clip looped for as long as the beat is spoken). Each beat becomes one shot, the way the episode's delivery asks; the shot list orders them and the render joins them.
_Avoid_: clip (that is the file), scene, segment (reserved for the sponsor segment).

**Recipe**:
The step list a screen shot follows in the runner's browser (go to a URL, click, type, wait). Recipes run against the operator's signed-in browser profile, so a tool the persona demos must be signed in first.
_Avoid_: script (that is the spoken text), macro, scenario, test.

**Render**:
The finished video file for one aspect ratio (16:9 for YouTube, 9:16 for TikTok, Reels and Shorts), with voice and captions mixed in. One episode has one render per aspect ratio it publishes.
_Avoid_: export, output, final.

**Publication**:
One episode on one platform: the upload, its title and description, its external id, its URL, its publish time, its AI-disclosure label, and the metric snapshots taken afterwards. Its status is one of draft (waiting in a publish package), queued, uploading, live, failed, or withdrawn (its episode was killed before it went out, so it never will). A video's description off X is the persona's own text inside a footer composed when it goes out: the disclosure above, then below it the Formstep line, then the tracked link (or "Link in bio.") and the discount code in force, in the order the episode's description format sets: the link first by default, the code first under the "Code first" variant. On X nothing is appended: a video's text is its title, a post is its parts.
_Avoid_: post (fine in UI copy for TikTok and Instagram, never as the term), upload, release.

**Publish package**:
A rendered episode's publications waiting for the operator's approval: per platform the render it uploads, its title, the persona's own description, its publish time, and the footer composed at dispatch. The operator edits the titles and descriptions, never the footer, so an edit is never overwritten and a code change reaches every package not yet live. Approving it queues every publication and schedules the episode. A persona set to publish on its own skips the package: its rendered episodes are scheduled at once. A text post or a thread has none; its approval schedules it.
_Avoid_: bundle, preview (fine casually), draft (that is a publication's status inside the package), release.

**Episode status**:
Exactly one of: **idea** (concept only, until its just-in-time script is written the day before it goes out), **scripted** (script written, waiting for operator approval), **waiting on you** (a checklist item blocks it), **recording** (producer is recording shots), **rendered**, shown as "Ready to publish" (renders exist; the publish package waits for the operator's approval), **scheduled** (publications queued), **published** (every publication live), **measured** (metrics collected after the measurement window), **failed** (an agent run gave up; the error is on the episode), and **killed** (the operator withdrew it, on its page or in the chat; its publications that had not gone out are withdrawn and its queued jobs fail). Scripted episodes wait for the operator's approval before recording unless the persona is set to auto-approve, and rendered ones wait for approval of their publish package unless the persona publishes on its own. Needs approval, waiting on you and ready to publish are what "waits on you" counts; failed is counted on its own.
_Avoid_: draft (that is a publication in a package), in progress, done, live (that is a publication), pending.

**Measurement window**:
The time after publishing (72 hours by default) during which the analyst snapshots metrics before marking an episode measured and feeding its experiment.
_Avoid_: attribution window (that is for conversions), cooldown.

## Research

**Signal**:
One thing the researcher found worth reacting to: a Hacker News story, a Reddit thread, a Google trend, a competitor's video, a search suggestion people type into Google, a comment under one of the persona's publications, or a problem from the persona's problem log. A signal has a source, a title, a URL (none for a problem), a score, topics, when the source says it was posted, and the episodes it fed. Every ranking reads its freshness, not its score. Signals age out after two weeks unless an episode used them.
_Avoid_: trend (that is one source), post, item, insight, topic (that is a tag on a signal).

**Source**:
Where signals come from: `hackernews`, `reddit`, `google_trends`, `youtube_search`, `search` (search suggestions), `comments`, `problems` (the problem log). The researcher polls the first five, each a provider with a mock and a real adapter; comments come from the publisher's comment reading and problems from the problem log.
_Avoid_: feed, channel (that is a platform account), integration.

**Freshness**:
How much a signal still matters today: its score, halved every two days since the source posted it (or since the researcher found it, when the source does not say). Computed when it is read, never stored. Below 25 a signal is **cold**: the planner leaves it out, and an idea built on it is swapped at its last check.
_Avoid_: recency, decay (fine for the mechanism), heat, trending score.

**Morning brief**:
The researcher's short daily note per persona, written by the morning sweep after it polls every source: how many items each source found, the five freshest, and the open problems, or "Nothing new moved since yesterday." when nothing did. A memory entry that expires the next day; the next morning's brief supersedes it. The writer reads the brief in force before every script, and the persona page shows it.
_Avoid_: digest (that is the publisher's comment digest), research brief (that is the chat task), report, summary.

**Problem log**:
The problems a persona met itself, as memory entries: a question viewers keep asking under its videos (three or more comments in two weeks asking the same thing), or a tool that broke while it was recorded (never the sponsor, never the presenter). Each **problem** is logged once and gathers its evidence as it repeats, becomes a signal with a high score so the planner and the last check can pick it, and is read by the writer. A problem stays open until the operator marks it **resolved** on the Memory page; its comments then never count toward it again, so the same question asked three more times opens a new one.
_Avoid_: issue, bug, ticket, complaint, FAQ.

**Last check**:
The researcher's look at an idea just before its script is written: if the signal it reacts to went cold, the idea's concept is swapped for the persona's strongest fresh signal (freshness 60 or more), and the journal says so with both freshness numbers. An evergreen idea, one whose signal is still warm, or one with nothing fresh enough to swap in is written as planned.
_Avoid_: recheck, validation, refresh, swap check.

**Content pillar**:
One of three to five recurring subjects a persona always returns to ("n8n tutorials", "AI agent workflows", "automation fails"). Pillars keep a persona consistent. A reactive episode draws from the pillar its signal fits; the rest of the week is shared out by the pillar weights in the persona's strategy.
_Avoid_: category, theme, niche (that is the whole persona's field), series.

## Experiments

**Experiment**:
A question a persona tests across its videos, its X posts, or its replies ("Do 'I was wrong about…' hooks beat 'How to…' hooks on click rate?"): a hypothesis, a metric, two or more variants on one dimension, and a decision rule. A persona runs one at a time, picked by its strategy review from the experiment catalog or set up by the operator. Videos and X posts are assigned a variant at planning time, replies when the listener keeps them; the analyst compares variants after each measurement window. X posts and replies carry no link, so a test on them is decided on views or follows.
_Avoid_: A/B test (fine in conversation), split test, campaign, trial.

**Variant**:
One arm of an experiment, with a key and a description the writer follows. The **control** is what the persona did before on that dimension: its default.
_Avoid_: option, arm (fine in statistics), treatment, version.

**Metric**:
What an experiment or report measures: `views`, `watch_rate`, `follows`, `clicks`, `signups`, `paid`. Views, watch rate, and follows come from the platforms; clicks from tracked links; signups and paid from PostHog.
_Avoid_: KPI, goal, stat.

**Decision**:
The analyst's verdict on an experiment once a variant leads with enough confidence: which variant won and by how much. What the persona does next follows from it: the winner becomes the persona's default on the experiment's dimension, and the decision leaves a learning. The operator can decide a running experiment themselves instead; their verdict sets the default and leaves a learning the same way, with their reason. An experiment is decided once: a decided one is not decided again, so a default changes only through a new experiment.
_Avoid_: result, winner (fine in copy), outcome.

## Strategy

**Strategy**:
What a persona does by default and what it tests next: a default per dimension, the weight each content pillar gets in the plan, a publish hour per platform, and the one experiment it runs. The analyst changes it in the strategy review, the planner and the writer follow it, and every change is written to the journal with its reason.
_Avoid_: plan (that is the week's calendar), playbook, settings (those are the operator's), config.

**Strategy review**:
The analyst's weekly look at one persona (Monday morning, before the week is planned, or when the operator asks): it shifts pillar weight toward the pillar that earns most, moves a publish hour that another hour clearly beats, re-tests a default that later data contradicts, and starts the next experiment when none runs. Every rule is fixed and needs no model; a review that finds nothing to change changes nothing and says nothing.
_Avoid_: audit, retro, optimization, analysis (fine casually).

**Dimension**:
One thing that an experiment varies. For videos: hook style, concept angle, sponsor placement, episode length, call to action, publish time, or description format. For X posts: post kind. For replies: reply style and reply target. Each has its variants in the experiment catalog and one default per persona. Sponsor placement applies only to sponsored episodes. The writer scripts the first five video dimensions; publish time and description format never reach the script. The strategy review tests a dimension only where it can compare something: the X dimensions only for a persona on X, the video ones only for a persona with a video platform.
_Avoid_: axis, factor, lever, kind (its name in code only, `experiment.kind`).

**Publish time** (dimension):
When a video goes out against its platform's usual hour: at it, three hours earlier, or three hours later, within the same day. It varies videos only; X posts keep their own slots. A decided publish time test keeps no default: it moves the persona's publish hours, which stay the hour's one home.
_Avoid_: posting time, schedule (that is the publish time of one publication), slot.

**Description format** (dimension):
The order of the lines a video's description carries under the persona's own text: the tracked link first and the discount code under it, or the code and its offer first. The disclosure stays the first line either way, and nothing changes on X. It applies only to a persona with a discount code in force and a platform besides X.
_Avoid_: description style, footer order (fine casually), layout.

**Post kind** (dimension):
What each single X post of the week is: rotated through the kinds the X cadence holds (the control), always a text post, or always an image post with a card. Threads keep their slots and carry no variant. It applies only to a persona whose X cadence holds both text and image posts.
_Avoid_: post format, post type.

**Reply style** (dimension):
How a reply adds something of the persona's own: one concrete tip (the control), a short question back, or what happened when it hit the same thing. The listener gives each reply it keeps the next variant in turn, and the writer follows it.
_Avoid_: reply tone (tone belongs to the bible and the voice), reply template.

**Reply target** (dimension):
Which posts found by search the listener answers: the ones whose authors have the most followers first (the control), or only **peers**, authors under 10,000 followers, where a reply stands out. One sweep follows one target, so the found posts of a sweep share its variant; mentions and replies under the persona's posts carry none.
_Avoid_: audience, segment, niche.

**Experiment catalog**:
The variants a persona can test on each dimension, each with the instruction the writer follows ("Open with the question the viewer has"). The first variant of each dimension is its control, what personas did before. The strategy review picks experiments from it, the dimension the persona knows least about first; the operator's new experiment form fills in from it.
_Avoid_: library, menu, templates, playbook.

**Default**:
What a persona does on one dimension when no experiment varies it: the winning variant of the last experiment decided on that dimension, from the day it was decided, or the catalog's control until one is. Publish time has none: its decision moves the publish hours instead. An episode that carries a variant follows it on its experiment's dimension and the defaults on every other. A default that later data contradicts (its rate since the decision falls to the runner-up's rate at the decision) is tested again, not trusted forever.
_Avoid_: preference, setting, baseline (that is the control), winner (fine in copy; it is the decision's word).

**Goal metric**:
The metric the strategy review gives a new experiment: the one closest to paying Formstep customers that has enough data, down the ladder paid, signups, clicks, follows. Follows stand in for views at the bottom because a decision compares two rates: views per episode is not a rate, follows per view is. A test on X posts or replies always aims at follows, since they carry no link.
_Avoid_: KPI, north star, objective, target.

**Journal**:
A persona's dated record of every change to its strategy, and of every concept a last check swapped: what changed in one sentence, the reason with its numbers, the evidence it rests on (an experiment, episodes, signals), and who made it, the analyst, the researcher (a concept swapped at a last check) or the operator. Never edited; the strategy page shows it newest first.
_Avoid_: log (that is the jobs), history (that is the X account's imported posts), changelog, audit trail.

**Memory**:
What a persona keeps knowing from one episode to the next: short entries, each with a kind, who wrote it (the operator, the analyst or the researcher), the evidence it rests on (episodes, an experiment, signals, or the operator's chat message), and a status (active, superseded or retired). Six kinds: a fact and a rule from the operator, a learning and a goal note from the analyst, the morning brief and a problem from the researcher. A newer entry on the same subject supersedes the older one; the operator retires a fact or a rule they take back ("forget") and a problem they resolved. Nothing is deleted, so the persona can show why it believes something. The writer reads the goal note, the rules, the facts, the learnings, the brief and the open problems before every script and post. The Memory page shows every entry with its evidence.
_Avoid_: notes, knowledge base, context (that is what one agent run reads).

**Fact**:
Something true the operator tells a persona to keep ("viewers hate the word 'guys'"), in the chat ("remember that …") or on the Memory page. The writer reads it before every script and post until the operator forgets it.
_Avoid_: note, info, knowledge.

**Rule**:
Something the writer must always or never do, from the operator ("never show a customer's real email address on screen"), in the chat ("remember to …", "remember: always …") or on the Memory page. A directive steers what the persona makes for a while and is withdrawn when it is done; a rule is a lasting constraint on how every script and post is written, kept until the operator forgets it. The writer never breaks one.
A rule about whom the persona answers on X ("never reply to politics", "only reply to people building agents") is stored as a rule from the chat without "remember", and the writer passes on a post it covers unless the operator asks for that reply.
_Avoid_: constraint, guideline, policy, directive (that is a focus for a while).

**Asset**:
A file in a persona's asset library: an image, a clip, an audio track or a document, with the name the writer asks for it by, tags and a note. The operator uploads one on the Assets page, or the producer saves one: each render, the voice track, an image post's card, named after its episode. The writer can show an image or a clip in a beat by its name ("show the retry loop"), never in the sponsor demo beat, and the producer places it in that beat's shot. An asset a script that may still be recorded shows stays until that episode is measured or killed; taking a render out of the library leaves it on its episode.
_Avoid_: media, attachment, upload (that is how the operator adds one), file (that is what it holds).

**Asset library**:
A persona's assets, the operator's uploads and what the producer made, newest first. Before every script the writer sees up to 30 of its images and clips, the operator's first, with their names, tags and notes.
_Avoid_: media library, gallery, drive.

**Generated picture**:
A still or a short clip the producer generates from a prompt with the media provider (gpt-image-1 for stills, Seedance for clips), where a beat would otherwise show an asset, or for the operator on the Assets page. The writer asks for one in a beat in place of an asset, never on the sponsor's demo beat; it is made before recording, in the persona's look, saved to the asset library as the producer's, tagged generated, with the prompt and the model in its note, and the beat shows it as its asset. A video waits for its pictures before it can be approved. Nothing generated shows a real person, a brand other than Formstep, a real product's screen or a screenshot: a tool's real screen is recorded. Each persona has a daily budget of images and seconds of clips; a generation that would pass it fails with the budget in its error. `generations` in code.
_Avoid_: AI art, render (that is the producer's cut of an episode), stock image.

**Goal**:
The one thing every persona works toward: paying Formstep customers. It is the workspace's, named from its sponsor; the strategy review aims experiments at it through the goal metric, and every review writes a goal note against it.
_Avoid_: objective, target, north star, KPI.

**Goal note**:
The memory entry every strategy review leaves: the persona's paid customers in the last 28 days with what they are worth, the trend against the 28 days before, and what it tries next (the experiment that runs after the review). The newest supersedes the one before it; the writer reads it, and the strategy page shows it under the goal.
_Avoid_: status report, scorecard, progress note.

**Learning**:
The memory entry a decision or a review's change leaves. From a decision: on which dimension which variant beat which, on which metric, by how much and how surely, or the operator's reason when they decided. From a review: what the numbers showed and what the persona does since (the pillar weights, a platform's publish hour). The writer reads the persona's active learnings before every script and post. A newer learning on the same subject (a dimension, the pillars, one platform's hour) supersedes the older one.
_Avoid_: insight, lesson, finding, takeaway.

## Engagement

**Reply**:
A post on X the persona writes under someone else's post: the post it answers and its author, where that post came from (a mention, a reply under the persona's own post, or the listener's search), the reply's text, its status (being written, waiting for you, goes out on its own, sending, sent, failed, skipped), when it went out, and what it brought back (impressions, likes, replies, profile visits, follows), which the analyst reads for a week. A skipped reply keeps the reason: the writer passed on it, a rule covers the post, the post names the sponsor, the operator skipped it, or the draft went stale after a day. Influstep never likes, reposts or follows.
_Avoid_: comment (that is a viewer's words under an episode, a signal), engagement (that is the whole practice), interaction, response.

**Listener**:
The researcher's sweep of X every three hours for posts worth answering: mentions of the persona and replies under its posts for two days, and posts in its pillars found by search for twelve hours, from authors with at least 1,000 followers, at most three per sweep, chosen by the persona's reply target. A post the persona already answered or passed on is never heard twice, and a post naming the sponsor is kept as skipped until the operator asks for a reply.
_Avoid_: monitor, scraper, crawler, social listening.

**Engaged first**:
A post whose author reached the persona first: a mention or a reply under its post. Only such a reply may go out on its own, and only when the persona publishes on its own; a reply to a post the listener found by search waits for the operator, who posts it with one click per reply, never in a batch.
_Avoid_: inbound, warm, organic.

**Reply budget**:
How many replies a persona sends a day on X, by hand and on its own together, 0 to 20 (5 by default), counted from local midnight. Zero turns the listener off for the persona. The operator sets it with the X post cadence; a post past it is refused until tomorrow or a higher budget.
_Avoid_: quota, limit (fine casually), rate limit.

## Attribution

**Tracked link**:
A short link (`/go/<slug>`) that a publication carries in its description, bio, or pinned comment. The worker counts each click and redirects to Formstep with UTM parameters naming the persona, the episode, and the platform, so PostHog can tie a signup back to the episode.
_Avoid_: affiliate link, UTM link, short URL, redirect.

**Link in bio**:
The one page per persona (`/p/<handle>`) that platforms without clickable descriptions point to. It lists the persona's latest episodes and the sponsor's tracked link. Each platform's bio carries its own address, `/p/<handle>?via=<platform>`, and the page passes the platform on to the sponsor link's click, so the report counts a bio's clicks on the platform they came from.
_Avoid_: landing page, profile page, hub.

**Conversion**:
A Formstep event tied to a persona by UTM: a signup, a first published form, or a paid subscription. Conversions reach Influstep from PostHog.
_Avoid_: sale, lead, goal (that is the workspace's goal, paying customers; PostHog's goals are conversions).

**Report**:
The one page per persona that answers "is this persona working?": followers, views, clicks, signups, and paid over time, the funnel from view to paid, the replies on X with the follows they brought, and the open experiments. Kept to one screen; detail lives in the episode list. Reports open on the workspace report: every persona's funnel over the window added up, an engagement line (likes, comments, watch rate, follows per view), one row per persona with the same columns, and what works. Every number says where it comes from: the platforms' own counts, exact clicks and code redemptions, or conversions PostHog attributes first touch.
_Avoid_: dashboard (fine casually), analytics (that is the data), insights.

**What works**:
Three ranked lists on the workspace report over every persona's measured videos of the last 28 days: by pillar, by hook style (the one a script was written in, stamped when the writer stores it), and by sponsor segment, each ranked by value per video, then clicks per view. A persona's strategy review moves its pillar weights on the same numbers, counted for that persona alone.
_Avoid_: insights, best practices, leaderboard.

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
An external capability behind an interface with a mock and a real adapter: `llm`, `voice`, `avatar`, `publisher` (one per platform), `signals` (one per source), `analytics` (PostHog), `engagement` (the listener's search and a reply's counts on X). The provider mode is chosen explicitly per deployment; nothing falls back to mock when a key is missing.
_Avoid_: integration, service, plugin, connector.

**Plan**:
The persona's calendar for the coming week: which episodes on which days, which variant each carries, which carry the sponsor. The planner job writes it; the operator edits it on the calendar or with a chat change.
_Avoid_: schedule (that is the publish time), roadmap, queue.

**Pause**:
The operator's kill switch on a persona: nothing records, publishes, or replies until the persona is resumed. Scheduled publications wait; nothing is lost.
_Avoid_: disable, stop, archive, mute.
