# ADR 0003: Attribution runs through tracked links and PostHog

**Status**: accepted, 2026-10-09

## Context

The goal is Formstep users, not views. Platforms report views and follows but nothing about what happened after a click. Formstep already sends product events to PostHog.

## Decision

Every publication carries one tracked link, `/go/<slug>`, served by the Worker. A click is counted in Influstep and redirected to formstep.io with `utm_source=<persona handle>`, `utm_medium=<platform>`, `utm_campaign=<episode slug>`, and `utm_content=<variant key>`. PostHog's first-touch UTM properties then tie Formstep's `signed_up`, `form_published`, and `subscription_started` events to the persona, episode, and variant. The analyst pulls those counts from PostHog's query API (HogQL) per persona and stores them as metric snapshots, so the report's funnel is view → click → signup → paid with one source per step.

## Consequences

- Attribution is first-touch by UTM; a viewer who clicks twice from two episodes credits the first. Good enough for choosing between variants, and the report says so.
- Clicks are real even in mock mode (the Worker counts them locally); signups and paid are mock until PostHog keys are set.
- The PostHog project must keep `$initial_utm_*` person properties, which is PostHog's default.
