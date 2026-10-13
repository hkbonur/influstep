---
name: Influstep
description: Calm, light-first product chrome for Influstep, the sibling of Formstep's design system. One Inter family, tinted neutrals, one quiet green for "working", and a fixed set of status tints for the episode pipeline.
colors:
  paper: '#ffffff'
  paper-tint: '#fafafa'
  paper-warm: '#f5f5f5'
  mist: '#e5e5e5'
  fog: '#d4d4d4'
  smoke: '#a3a3a3'
  ash: '#737373'
  graphite: '#404040'
  ink: '#262626'
  ink-deep: '#0a0a0a'
  hairline: '#0000000a'
  hairline-strong: '#00000014'
  field-green: '#10b981'
  field-green-deep: '#047857'
  field-green-soft: '#ecfdf5'
  signal-red: '#ef4444'
  signal-red-deep: '#b91c1c'
  alert-amber: '#f59e0b'
  alert-amber-deep: '#b45309'
  note-blue: '#3b82f6'
  note-blue-deep: '#1d4ed8'
  chart-cyan: '#0ea5e9'
  chart-violet: '#a855f7'
  chart-amber: '#f59e0b'
  chart-emerald: '#10b981'
  chart-red: '#ef4444'
  dark-paper: '#111111'
  dark-card: '#141414'
  dark-sidebar: '#171717'
typography:
  display:
    fontFamily: 'Inter Variable, Inter, system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: '-0.02em'
  title:
    fontFamily: 'Inter Variable, Inter, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: '-0.005em'
  body:
    fontFamily: 'Inter Variable, Inter, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 'normal'
  label:
    fontFamily: 'Inter Variable, Inter, system-ui, sans-serif'
    fontSize: '0.6875rem'
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: '0.18em'
  mono:
    fontFamily: 'JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 'normal'
rounded:
  sm: '0.375rem'
  md: '0.5rem'
  lg: '0.625rem'
  xl: '0.75rem'
  2xl: '1rem'
  pill: '9999px'
spacing:
  unit: '0.24rem'
  xs: '0.25rem'
  sm: '0.5rem'
  md: '1rem'
  lg: '1.5rem'
  xl: '2.5rem'
---

# Design System: Influstep

## 1. Overview

**Creative North Star: "The Quiet Control Room"**

Influstep is a product surface the operator opens a few times a week to answer three questions: what are the personas doing, what is waiting on me, and is it working. The chrome stays out of the way; the calendar and the report carry the page. It inherits Formstep's tokens (paper, ink, one green) so the two products read as siblings, and adds two things Formstep does not have: a **status tint scale** for the episode pipeline, because the calendar is a wall of episode cards and their state must be legible at a glance; and eight **persona colors**, identity hues confined to persona avatars and the color swatches, so the operator tells personas apart without reading a name.

Rejected: dashboard grids of a dozen equal widgets, colored KPI tiles, gradient funnels, "AI sparkle" iconography, chat bubbles styled like a consumer messenger. Reference points: Linear's issue board, Notion's calendar, Stripe's reports.

**Key characteristics**

- One Inter family. JetBrains Mono for counts, timestamps, handles, slugs, and job payloads.
- Tinted neutrals. `#000` and `#fff` never appear as tokens.
- One saturated color in the chrome: Field Green means "working" (a persona running, a publication live, an experiment decided). Red means failed or blocked, amber means waiting on the operator, blue means informational. Never more than one role per element. Persona colors are identity, not chrome: they stay inside avatars and the color swatches, and never carry state.
- Hierarchy by weight and opacity, not by grey text colors (One Ink Rule).
- Flat by default; shadows only on popovers and dialogs.
- Density: product-compact. 32px controls, 14px body, 12-column grid, 16px gutters at phone width.

## 2. Colors

Same palette as Formstep (see frontmatter), plus the persona colors, which live in the studio's `styles.css` and the table under Persona colors below, not in the frontmatter. Rules that matter here:

**Status tint scale (episode pipeline).** Each episode status has one tint, applied as a 6% background wash and a 100% dot on calendar cards and as a pill in lists. Never a side stripe. Tints are the semantic colors, never new hues:

| Status         | Tint        | Reads as              |
| -------------- | ----------- | --------------------- |
| idea           | fog         | not yet real          |
| scripted       | note-blue   | needs your approval   |
| waiting on you | alert-amber | blocked on a human    |
| recording      | smoke       | agents busy           |
| rendered       | note-blue   | ready to publish: needs your approval |
| scheduled      | field-green | will go out on its own |
| published      | field-green | live                  |
| measured       | ink         | done, in the report   |
| failed         | signal-red  | look at this          |
| killed         | fog         | withdrawn, struck through |

**One saturated voice per screen.** The calendar shows every tint at once because they are content. The chrome around it (nav, buttons, headers) stays ink on paper. Persona avatars are the one exception: wherever a persona avatar appears, including the sidebar roster and the persona header, it shows the persona in its own color, because the color is identity, not the chrome's voice, and it never says anything about state.

**Persona colors.** Each persona wears one of eight identity hues, so the operator tells personas apart at a glance. They are defined in OKLCH as `--color-persona-*` in the studio's `@theme` (`apps/studio/src/styles.css`, the source of truth), mid lightness and moderate chroma, each at least 3:1 against paper (WCAG 1.4.11, graphical objects) and distinct from the others at 24px:

| Name   | OKLCH                                        |
| ------ | -------------------------------------------- |
| Ink    | the ink token (Formstep's own mascot color)  |
| Plum   | `oklch(47% 0.13 342)`                        |
| Violet | `oklch(50% 0.17 298)`                        |
| Iris   | `oklch(56% 0.14 260)`                        |
| Teal   | `oklch(55% 0.09 200)`                        |
| Olive  | `oklch(55% 0.1 125)`                         |
| Clay   | `oklch(56% 0.13 45)`                         |
| Rose   | `oklch(57% 0.17 3)`                          |

They appear only inside persona avatars and the color swatches (Components), never on text, pills, buttons or status marks. A persona color says who, never what state: a persona waiting on the operator still gets the amber count, a failed one the red dot. A new persona starts with the first color no persona wears; after eight, colors repeat.

**Character counter.** A post part counts toward X's 280 as the operator types, the way X counts (every link weighs 23). Under 90 percent of the limit the count is ash; from 90 percent up to the limit itself it turns alert-amber-deep, a warning the operator acts on; past the limit it turns signal-red-deep, because X refuses the part and the studio will not save it. The count is 11px mono (0.6875rem), smaller than the Mono role so it sits beside the 12px part label; the deep shades keep those small numbers legible on paper. Amber and red keep their meaning here (look at this, blocked); they never wash a background or mark a status. Color is not the only signal: the field names its counter as its description, and the counter is a polite live region that says "near the limit" or "over the limit" in words. The publish package counts by the same rule: an X post text by X's count against 280, a video title against YouTube's 100 and a description against 1,500, both in characters.

**Charts.** The report's funnel and trend lines use the chart series in canonical order: cyan, violet, amber, emerald, red. Followers always cyan, views violet, clicks amber, signups emerald, paid red. Fixed assignment, so the operator learns the colors once. Demos and trials are the lighter shade (55%) of the step they lead from: demos of clicks amber, trials of signups emerald.

## 3. Typography

- **Page title** Inter 600, 1.5rem, tracking -0.02em. One per page.
- **Card title** Inter 600, 1rem.
- **Body** Inter 400, 0.875rem, line-height 1.5.
- **Metric eyebrow** Inter 600, 0.6875rem, uppercase, tracking 0.18em. Reserved for the report's metric strip and section eyebrows.
- **Metric value** Inter 600, 1.5rem, tabular numbers (`font-variant-numeric: tabular-nums`).
- **Mono** JetBrains Mono 0.8125rem: handles (`@automation.ada`), slugs, timestamps, counts in tables, job payloads.

## 4. Layout

- Left sidebar, 232px, paper-tint, collapsible to a 56px rail. Sticky at the top of the window while the page scrolls. Nav with Phosphor icons (regular at 16px, fill on the active item): Calendar, Personas, Experiments, Signals, Checklist, Reports, Providers; the rail shows the icons alone, and the checklist count becomes an amber dot. Under the nav, a Personas section: the eyebrow and a + to the new persona form, then one row per persona, oldest first (28px avatar, name, at most one mark at the right: an amber count of what waits on the operator, else a red dot for a failed episode). The row of the persona the page belongs to (its page, its voice, its report, one of its episodes) gets a paper-warm wash. Only the roster scrolls; the nav and the runner footer stay put. On the rail the avatars stack with a 36px hit area and the mark becomes a dot on the avatar's corner.
- Content column with 24px padding, max 1280px.
- Calendar: seven equal columns, today's column paper-warm, cards stacked by scheduled time.
- Persona page: three panes on wide screens (chat 1fr, script 1.4fr, checklist 0.8fr); stacked on narrow. An X persona's profile has a Voice row ("Learned from 40 posts, Norwegian Bokmål", the language named by the browser, or "Not learned yet") that links to its voice page.
- Voice page (`/personas/<id>/voice`, X personas only): one column, at most 64rem, four sections under eyebrows, top to bottom. **Account**: the handle in mono and the X connect checklist item's state (an amber "Waiting on you" pill with the item's title while it is open, "Connected" once it is done), with a link to the checklist. **History**: the totals (posts, the account's own, replies to others) with a quiet line of counts by source, Clear history at the right, a status line under the totals that says when the history is being deleted and when it is gone (a big history goes a page of 500 posts at a time, Clear history is hidden meanwhile, and an import or Learn the voice is refused until it is gone), and the three imports as three cards in a row (stacked on narrow): Upload archive, Paste posts, Import from X. **Voice**: Learn the voice (primary until a voice exists, then an outline Learn again), with the job's state under it and, below the sample minimum, the reason in visible text, never only in a tooltip; then the editable language, summary and traits with Save on the left (the edit's problems are listed under the fields as the operator types, and each field with a problem is marked invalid and described by that list), and the length mix bar and the emoji and hashtag habits as plain words on the right. **Examples**: one list, the example posts first, then a "Top posts" separator and the top posts, each a row with the post's text, its date, likes and reposts in 11px mono ash, and an Example checkbox at the right. A persona without X sees the page title and one line saying the voice is for X only.
- Report: metric strip (six values), then one funnel, then one trend line, then the experiments list. Fits one screen at 1440x900.

## 5. Components

- **Button primary**: ink on paper-tint, 2rem high, rounded lg. Hover ink-deep.
- **Button ghost**: transparent, hover hairline-strong.
- **Button destructive**: signal-red, used only for Kill, Pause, and Clear history with its Delete history confirm.
- **Pill**: status tint at 18% background, deep tint foreground, rounded pill, 1.25rem high.
- **Card**: paper, hairline border, rounded xl, 1rem padding.
- **Episode card** (calendar): status tint as a 6% wash with a dot before the title; a 35% tint border when the card needs the operator: the statuses that wait on them (needs approval, waiting on you, ready to publish; shared `waitsOnOperator`) and failed. The calendar's lead counts the same cards, one bucket per status ("1 failed, 2 needs approval, 1 ready to publish"). Title at weight 500, persona handle in mono under it with the publish time, platform glyphs on the last row.
- **Post card** (calendar): the episode card for a text post, an image post or a thread. Same wash, dot, border and rows; in place of the title, the kind icon and the post's first line at weight 500, clamped to two lines. Before the writer has written the post, the planned title stands in for the first line. Under the first line, indented past the icon, the post's intent and length in 11px ash ("Ask · One-liner"). Videos keep the plain episode card.
- **Intent and length**: what the planner asked of a post, as plain words joined by a middle dot: the intent (Ask, Inform, Share, Teach), then the length (One-liner, Post, Thread). Small and ash wherever it appears, on the post card and after the kind in the episode header; never a pill, never a control, because the operator edits the post, not its plan. A post planned before posts carried an intent and a length shows nothing.
- **Kind icons**: Phosphor, regular weight, 14px, graphite. TextT for a text post, Image for an image post, ListNumbers for a thread. A video has no icon. Used on the post card, in a persona's episode list and in the episode header. The icon is hidden from screen readers and the kind's name is its text alternative: printed beside the icon in the episode header, screen-reader only elsewhere, so the kind is never read twice.
- **Platform glyphs**: mono tags on a hairline-strong chip: YT, TT, IG, and X for X. In the report's by-platform table the glyph sits before the platform's name and is hidden from screen readers, since the name follows.
- **Beats editor** (episode page): a video's script editor, because the beats are the script the recording speaks. The title, then one block per beat in order: the beat's number in 12px mono ash, its title (input) and its spoken line (textarea), with "Its first sentence is the hook." in 12px ash under the first beat. A beat the delivery records as a screen adds a quiet read-only line in 11px mono ash, "On screen: n8n · app.n8n.cloud" (the tool and the host of its URL), since the tool and the URL stay the writer's. Beats are edited here, never added, removed or reordered. Under them the script's problems as the operator types (a polite live list, as in the post editor, and Save beats stays off while there are any), Save beats, and the spoken length, "120 words, about 50 s spoken of 45 s" in 12px ash: it informs and never blocks, since an operator may trim a script. Once recording starts the editor is the read view: the spoken script (every beat's line in order, a blank line between beats) with the same length line and the lock note.
- **Publish package** (episode page): once an episode has publications they lead the left column, one block per publication in platform order (YouTube, TikTok, Instagram, X) between mist rules. A block starts with the render in a frame of its aspect (16:9 up to 18rem wide, 9:16 up to 11rem): a muted video with controls, never autoplaying, preloading metadata only; an image post's card in its place; the aspect in 11px mono ash under it; or "Render missing" in 12px ash when the backend names no render. Beside it the platform name at weight 500 and the publish time in the persona's timezone, the time in mono with the zone's name in ash. A video off X has Title (counted against 100) and Description (counted against 1,500), the persona's own words, then the footer in a paper-warm block, 12px graphite, labeled "Added when it goes out" in 11px ash: the disclosure lines, "The description" in ash italics where the text goes, then the Formstep line, the code in force now and the tracked link in mono, or "Link in bio.". A code given or retired shows there at once, so the operator sees exactly what viewers get. X has one Post text field counted by X's rule and the line "Nothing is appended on X."; an image post shows its parts read only. Each draft has its own Save (small, outline, on while the text differs from what is saved) and, while it does, a ghost Discard that puts focus back in the title. A refused save shows under the block in a polite live region that stays mounted, and while it shows the block's fields are marked invalid and described by it. The header's Approve and schedule (primary) stays off while any draft holds an unsaved edit, and a polite live line in the section names the platforms to save or discard first. Once approved, that same line says how many publications were queued ("4 publications queued.") and takes focus, since the button leaves; while the approval is out the button tells assistive tech it is busy (aria-busy) and ignores a second click; it is never disabled then, which would drop focus. After approval the blocks read as text and carry their publication status pill: Draft note-blue, Queued fog, Uploading note-blue, Live field-green, Failed signal-red. A block that went out (uploading or live) labels its footer "Added when it went out" and shows the code it carried. A failed block has not gone out: its footer keeps "Added when it goes out" with the code in force, because a retry or a new render composes it again. A text post or a thread lists its publications the same way under "Publications", parts only: it is scheduled by its approval and never was a package. Before there are publications the right column says where they will come from and which code is in force.
- **Setting checkbox** (persona settings): an on or off setting as a fieldset: the setting's name as its legend in the field label style (Approval, Publishing), the checkbox with what checking it means ("Publishes on its own"), and an optional 12px ash hint under it that the checkbox is described by ("Off: each rendered episode waits for you as a publish package."). The persona list shows a set one as a fog pill ("Auto-approves", "Publishes on its own") and the profile says it in words ("You approve each package").
- **Post editor** (episode page): replaces the script editor for a post. Text and image posts have one textarea; a thread has two to six numbered parts with Add part and a ghost Remove on each part's label row. Every part's label row carries a character counter, `len / 280` in 11px mono, colored by the character counter rule above. Adding a part moves focus to its textarea; removing one moves focus to the part before it (or the new first part), so keyboard focus never falls back to the top of the page. Nothing is appended to a post on X (no link, no code), so what the editor shows is exactly what goes out; the automated-account label on the X account is the disclosure. A post's page shows "Goes to X" where a video has its platforms editor, and no length or delivery line.
- **Card preview** (image post): a 16:9 card under the card title field (whose counter reads `len / 60` in 11px mono by the same rule), rounded lg, at most 28rem wide. Once the producer has rendered the card, the preview is that picture and the card title field locks, with a hint that Rewrite changes it: a retry publishes the rendered card as it is. Until then it is a CSS card drawn like the producer's: paper tint with a mist border, the card title at weight 600 in ink, centred (before one is written, "No card title yet" in ash italics), the persona's name and handle in 11px mono ash under it, and a caption that names it a preview. It never takes the persona's color, because the rendered card does not, and a preview that differs from what X shows misleads.
- **Input / Textarea**: hairline background, rounded lg, 2rem high (textarea auto-grows).
- **Chat**: operator messages right-aligned on paper-warm, persona replies left on paper with a hairline and the persona's avatar beside them; directives extracted from a message show as a pinned list above the composer.
- **Checklist item**: checkbox, title, "unblocks: <episode>" in mono, optional action button. A page the operator must read and act on by hand (X's automated-account label setting) is an outline "Open" link that opens in a new tab; the runner never opens it.
- **Persona avatar**: Formstep's AI mascot (the bloub ball with two capsule eyes) drawn in the persona's color. Sizes: 20px in chat, 28px in the sidebar, 32px in lists, 48px in the persona header; 24px in the color swatches. Still frames everywhere except the persona header: a resting persona shows the idle still, a persona whose agents are working (a job queued or running) shows the thinking still, its three dots held. A paused persona rests, even with jobs waiting in its queue, and in the sidebar and lists its avatar is drawn in fog instead of its color.
- **Length mix bar** (voice page): how a feed splits into one-liners, posts and threads. One stacked bar, 8px high, fully rounded, segments in POST_LENGTHS order with a 2px paper gap between them, each as wide as its share (a zero share draws no segment). Neutral tones by length, lightest to darkest: smoke for a one-liner, ash for a post, ink for a thread, so more words read as more ink. Never a chart series color, which the report owns, and never the persona's color, which is identity. Under the bar a legend carries the numbers: an 8px swatch, the length's name and its whole percent in 11px mono ash. The bar is hidden from screen readers; the legend says the same in words. Without a learned voice the page draws the default mix the planner uses, and says so.
- **Import progress line** (voice page): one 12px line under an import card that says where the import stands: "Reading the posts…", then "Sent 1,000 of 3,214 posts…" with the counts in 11px mono, then "Added 3,100 posts; 114 were already here." An archive is read in the browser and sent in batches one after another, so the count only goes up and a failure stops at a known point: the error shows as an error line, and when posts already went in, a line says that importing again skips them and sends the rest. It is a polite live region that stays mounted, empty while idle, so each step is announced without moving focus.
- **Inline confirm** (Clear history): a destructive action that cannot be undone asks under its own button, not in a modal: one sentence that says what is deleted and what is not ("The posts stay on X"), then Cancel (ghost) and the destructive button. Focus moves to Cancel when the question opens, and Cancel hands it back to the button. The confirmed action removes the line the button sat in, so focus moves to a status line that stays mounted (tabindex -1, a polite live region) and says what happened, never to the top of the page.
- **Example toggle** (voice page): a checkbox labeled "Example" at the right of an imported post, described by the post's text. Its state is the server's: it moves once the save lands, and a refused save says why on the row, in a polite live region that stays mounted. The examples and the top posts are one list with a "Top posts" separator (a presentation item holding the heading), so a ticked row moves within the list and focus stays on its box. While the save is out the box is aria-busy and ignores clicks; it is never disabled then, since that would drop focus. At eight examples an unmarked box is disabled, and the section's line says to untick one first.
- **Job state** (voice page, under Import from X and Learn the voice): where the job a button queued stands, as one 11px mono ash line: a 6px dot, the status word and when it last moved ("Running 4 seconds ago"), with a failed job's error as an error line under it. Dot tints: field-green done, signal-red failed, note-blue running, fog queued; the persona's and the episode's job lists draw the same dot. Every status shows, done included. The line is not a live region itself: the caller wraps it in a polite live region that stays mounted, empty before the first job, so the job appearing and each change after it are announced.
- **Empty states**: one sentence and one action. No illustrations.

## 6. Motion

Respect `prefers-reduced-motion`. Cards fade in 120ms on status change; no spring on UI. Nothing animates while the operator reads a report.

The persona header mascot is the only looping animation: gaze drift and blinks at rest, the thinking dots while the persona works. It sleeps while off screen and paints stills under reduced motion.
