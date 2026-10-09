# Influstep

AI personas that publish short videos so their followers discover Formstep. One operator, a calendar of episodes, agents that research, write, record on your computer, publish, and report what converted.

## Run it locally

Needs Docker, Node 24 (`.nvmrc`), pnpm 11, and ffmpeg on PATH for the runner.

```bash
pnpm install
pnpm backend:up      # local Convex in docker, pushes the backend
pnpm seed            # two demo personas and a planned week
pnpm dev             # http://localhost:3300
pnpm dev:runner      # in another terminal: the local runner (mock providers)
```

Everything runs with mock providers by default: scripts, voices, recordings, uploads, and metrics are generated locally so the whole pipeline can be walked end to end. See `docs/plan.md` for how to switch each provider to its real adapter.

## Layout

- `apps/studio` — operator app (React, TanStack Router, Tailwind) on a Cloudflare Worker that also serves tracked links and link-in-bio pages
- `apps/runner` — local Node daemon: records screens with Playwright, voices, renders with ffmpeg, uploads
- `packages/convex` — backend: personas, episodes, experiments, signals, jobs, crons, providers
- `packages/shared` — types and pure helpers shared by all of the above

Read `CONTEXT.md` for the vocabulary and `docs/plan.md` for the plan.
