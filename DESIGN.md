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
| rendered       | smoke       | agents busy           |
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

**Character counter.** A post part counts toward X's 280 as the operator types, the way X counts (every link weighs 23). Under 90 percent of the limit the count is ash; from 90 percent up to the limit itself it turns alert-amber-deep, a warning the operator acts on; past the limit it turns signal-red-deep, because X refuses the part and the studio will not save it. The count is 11px mono (0.6875rem), smaller than the Mono role so it sits beside the 12px part label; the deep shades keep those small numbers legible on paper. Amber and red keep their meaning here (look at this, blocked); they never wash a background or mark a status. Color is not the only signal: the field names its counter as its description, and the counter is a polite live region that says "near the limit" or "over the limit" in words.

**Charts.** The report's funnel and trend lines use the chart series in canonical order: cyan, violet, amber, emerald, red. Followers always cyan, views violet, clicks amber, signups emerald, paid red. Fixed assignment, so the operator learns the colors once. Demos and trials are the lighter shade (55%) of the step they lead from: demos of clicks amber, trials of signups emerald.

## 3. Typography

- **Page title** Inter 600, 1.5rem, tracking -0.02em. One per page.
- **Card title** Inter 600, 1rem.
- **Body** Inter 400, 0.875rem, line-height 1.5.
- **Metric eyebrow** Inter 600, 0.6875rem, uppercase, tracking 0.18em. Reserved for the report's metric strip and section eyebrows.
- **Metric value** Inter 600, 1.5rem, tabular numbers (`font-variant-numeric: tabular-nums`).
- **Mono** JetBrains Mono 0.8125rem: handles (`@automation.ada`), slugs, timestamps, counts in tables, job payloads.

## 4. Layout

- Left sidebar, 232px, paper-tint, collapsible to a 56px rail. Sticky at the top of the window while the page scrolls. Nav with Phosphor icons (regular at 16px, fill on the active item): Calendar, Personas, Experiments, Signals, Checklist, Reports, Providers; the rail shows the icons alone, and the checklist count becomes an amber dot. Under the nav, a Personas section: the eyebrow and a + to the new persona form, then one row per persona, oldest first (28px avatar, name, at most one mark at the right: an amber count of what waits on the operator, else a red dot for a failed episode). The row of the persona the page belongs to (its page, its report, one of its episodes) gets a paper-warm wash. Only the roster scrolls; the nav and the runner footer stay put. On the rail the avatars stack with a 36px hit area and the mark becomes a dot on the avatar's corner.
- Content column with 24px padding, max 1280px.
- Calendar: seven equal columns, today's column paper-warm, cards stacked by scheduled time.
- Persona page: three panes on wide screens (chat 1fr, script 1.4fr, checklist 0.8fr); stacked on narrow.
- Report: metric strip (six values), then one funnel, then one trend line, then the experiments list. Fits one screen at 1440x900.

## 5. Components

- **Button primary**: ink on paper-tint, 2rem high, rounded lg. Hover ink-deep.
- **Button ghost**: transparent, hover hairline-strong.
- **Button destructive**: signal-red, used only for Kill and Pause.
- **Pill**: status tint at 18% background, deep tint foreground, rounded pill, 1.25rem high.
- **Card**: paper, hairline border, rounded xl, 1rem padding.
- **Episode card** (calendar): status tint as a 6% wash with a dot before the title; a 35% tint border when the card needs the operator (scripted, waiting, failed). Title at weight 500, persona handle in mono under it with the publish time, platform glyphs on the last row.
- **Post card** (calendar): the episode card for a text post, an image post or a thread. Same wash, dot, border and rows; in place of the title, the kind icon and the post's first line at weight 500, clamped to two lines. Before the writer has written the post, the planned title stands in for the first line. Videos keep the plain episode card.
- **Kind icons**: Phosphor, regular weight, 14px, graphite. TextT for a text post, Image for an image post, ListNumbers for a thread. A video has no icon. Used on the post card, in a persona's episode list and in the episode header. The icon is hidden from screen readers and the kind's name is its text alternative: printed beside the icon in the episode header, screen-reader only elsewhere, so the kind is never read twice.
- **Platform glyphs**: mono tags on a hairline-strong chip: YT, TT, IG, and X for X. In the report's by-platform table the glyph sits before the platform's name and is hidden from screen readers, since the name follows.
- **Post editor** (episode page): replaces the script editor for a post. Text and image posts have one textarea; a thread has two to six numbered parts with Add part and a ghost Remove on each part's label row. Every part's label row carries a character counter, `len / 280` in 11px mono, colored by the character counter rule above. Adding a part moves focus to its textarea; removing one moves focus to the part before it (or the new first part), so keyboard focus never falls back to the top of the page. Nothing is appended to a post on X (no link, no code), so what the editor shows is exactly what goes out; the automated-account label on the X account is the disclosure. A post's page shows "Goes to X" where a video has its platforms editor, and no length or delivery line.
- **Card preview** (image post): a 16:9 card under the card title field (whose counter reads `len / 60` in 11px mono by the same rule), rounded lg, at most 28rem wide. Once the producer has rendered the card, the preview is that picture and the card title field locks, with a hint that Rewrite changes it: a retry publishes the rendered card as it is. Until then it is a CSS card drawn like the producer's: paper tint with a mist border, the card title at weight 600 in ink, centred (before one is written, "No card title yet" in ash italics), the persona's name and handle in 11px mono ash under it, and a caption that names it a preview. It never takes the persona's color, because the rendered card does not, and a preview that differs from what X shows misleads.
- **Input / Textarea**: hairline background, rounded lg, 2rem high (textarea auto-grows).
- **Chat**: operator messages right-aligned on paper-warm, persona replies left on paper with a hairline and the persona's avatar beside them; directives extracted from a message show as a pinned list above the composer.
- **Checklist item**: checkbox, title, "unblocks: <episode>" in mono, optional action button. A page the operator must read and act on by hand (X's automated-account label setting) is an outline "Open" link that opens in a new tab; the runner never opens it.
- **Persona avatar**: Formstep's AI mascot (the bloub ball with two capsule eyes) drawn in the persona's color. Sizes: 20px in chat, 28px in the sidebar, 32px in lists, 48px in the persona header; 24px in the color swatches. Still frames everywhere except the persona header: a resting persona shows the idle still, a persona whose agents are working (a job queued or running) shows the thinking still, its three dots held. A paused persona rests, even with jobs waiting in its queue, and in the sidebar and lists its avatar is drawn in fog instead of its color.
- **Empty states**: one sentence and one action. No illustrations.

## 6. Motion

Respect `prefers-reduced-motion`. Cards fade in 120ms on status change; no spring on UI. Nothing animates while the operator reads a report.

The persona header mascot is the only looping animation: gaze drift and blinks at rest, the thinking dots while the persona works. It sleeps while off screen and paints stills under reduced motion.
