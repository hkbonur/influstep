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

Influstep is a product surface the operator opens a few times a week to answer three questions: what are the personas doing, what is waiting on me, and is it working. The chrome stays out of the way; the calendar and the report carry the page. It inherits Formstep's tokens (paper, ink, one green) so the two products read as siblings, and adds exactly one thing Formstep does not have: a **status tint scale** for the episode pipeline, because the calendar is a wall of episode cards and their state must be legible at a glance.

Rejected: dashboard grids of a dozen equal widgets, colored KPI tiles, gradient funnels, "AI sparkle" iconography, chat bubbles styled like a consumer messenger. Reference points: Linear's issue board, Notion's calendar, Stripe's reports.

**Key characteristics**

- One Inter family. JetBrains Mono for counts, timestamps, handles, slugs, and job payloads.
- Tinted neutrals. `#000` and `#fff` never appear as tokens.
- One saturated color in the chrome: Field Green means "working" (a persona running, a publication live, an experiment decided). Red means failed or blocked, amber means waiting on the operator, blue means informational. Never more than one role per element.
- Hierarchy by weight and opacity, not by grey text colors (One Ink Rule).
- Flat by default; shadows only on popovers and dialogs.
- Density: product-compact. 32px controls, 14px body, 12-column grid, 16px gutters at phone width.

## 2. Colors

Same palette as Formstep (see frontmatter). Rules that matter here:

**Status tint scale (episode pipeline).** Each episode status has one tint, applied as a 4% background and a 100% left rule on calendar cards and as a pill in lists. Tints are the semantic colors, never new hues:

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

**One saturated voice per screen.** The calendar shows every tint at once because they are content. The chrome around it (nav, buttons, headers) stays ink on paper.

**Charts.** The report's funnel and trend lines use the chart series in canonical order: cyan, violet, amber, emerald, red. Followers always cyan, views violet, clicks amber, signups emerald, paid red. Fixed assignment, so the operator learns the colors once.

## 3. Typography

- **Page title** Inter 600, 1.5rem, tracking -0.02em. One per page.
- **Card title** Inter 600, 1rem.
- **Body** Inter 400, 0.875rem, line-height 1.5.
- **Metric eyebrow** Inter 600, 0.6875rem, uppercase, tracking 0.18em. Reserved for the report's metric strip and section eyebrows.
- **Metric value** Inter 600, 1.5rem, tabular numbers (`font-variant-numeric: tabular-nums`).
- **Mono** JetBrains Mono 0.8125rem: handles (`@automation.ada`), slugs, timestamps, counts in tables, job payloads.

## 4. Layout

- Left sidebar, 232px, paper-tint, collapsible. Nav: Calendar, Personas, Experiments, Signals, Checklist, Reports, Providers.
- Content column with 24px padding, max 1280px.
- Calendar: seven equal columns, today's column paper-warm, cards stacked by scheduled time.
- Persona page: three panes on wide screens (chat 1fr, script 1.4fr, checklist 0.8fr); stacked on narrow.
- Report: metric strip (five values), then one funnel, then one trend line, then the experiments list. Fits one screen at 1440x900.

## 5. Components

- **Button primary**: ink on paper-tint, 2rem high, rounded lg. Hover ink-deep.
- **Button ghost**: transparent, hover hairline-strong.
- **Button destructive**: signal-red, used only for Kill and Pause.
- **Pill**: status tint at 18% background, deep tint foreground, rounded pill, 1.25rem high.
- **Card**: paper, hairline border, rounded xl, 1rem padding.
- **Episode card** (calendar): card with a 2px left rule in the status tint, title at body weight 500, persona handle in mono under it, platform glyphs right-aligned.
- **Input / Textarea**: hairline background, rounded lg, 2rem high (textarea auto-grows).
- **Chat**: operator messages right-aligned on paper-warm, persona replies left on paper with a hairline; directives extracted from a message show as a pinned list above the composer.
- **Checklist item**: checkbox, title, "unblocks: <episode>" in mono, optional action button.
- **Empty states**: one sentence and one action. No illustrations.

## 6. Motion

Respect `prefers-reduced-motion`. Cards fade in 120ms on status change; no spring on UI. Nothing animates while the operator reads a report.
