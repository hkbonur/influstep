# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Influstep runs AI personas that publish short videos so their followers discover Formstep. An operator sets up a persona; its agents research, write, record on the operator's computer, publish, and report conversions.

- `PRODUCT.md` — positioning. `DESIGN.md` — visual language.
- `CONTEXT.md` — domain glossary. Use its canonical terms (persona, episode, signal, experiment, checklist item, tracked link, runner, job, provider) in code, copy, and commits, and avoid the words it lists under _Avoid_. The sponsor is **Formstep** (never "Formbase", never "form-based").
- `docs/plan.md` — the build plan and the idea backlog. `docs/adr/` — decisions and why.

## Commands

pnpm 11 + Turborepo, Node 24.21.0 (`.nvmrc`).

```bash
pnpm backend:up           # docker Convex on :3220/:3221, admin key, push functions (packages/convex/.env.local)
pnpm backend:push         # push packages/convex again after a change (convex dev --once)
pnpm backend:down         # stop the container (data volume stays)
pnpm seed                 # demo personas, a planned week, signals, an experiment
pnpm dev                  # studio app on :3300 + convex dev watcher
pnpm dev:runner           # local runner (records, voices, renders, uploads); mock providers by default
pnpm build
pnpm test                 # Vitest, every package
pnpm quality:check        # oxlint + oxfmt + tsc
pnpm quality:fix
pnpm knip

# One package, one test
pnpm --filter @influstep/convex exec vitest run src/core/pipeline.test.ts -t "test name"
pnpm --filter @influstep/convex codegen   # regenerate src/_generated after an API change
```

- Formatting is **oxfmt** and linting is **oxlint**. Never run prettier or eslint.
- Turbo tasks depend on `^build`.
- The studio app's `tsc:check` runs `gen:routes` first; `src/routeTree.gen.ts` is generated and gitignored.
- Providers run in mock mode unless `PROVIDERS_MODE=real` is set on the Convex deployment and the runner. Real adapters need their keys; a missing key is an error, never a fallback to mock (ADR 0002).

### Local backend notes

- **Schema change with old rows.** From `packages/convex`, run `npx convex run internal/seed:reset` while the old code is still pushed, then `pnpm backend:push` from the root, then `npx convex run internal/seed:run`. The root has no `seed:reset`. `pnpm seed:fresh` wipes the demo data too. Persona and episode ids change on every reset.
- **The backend bundles `packages/shared`.** After editing shared, run `pnpm backend:push` again. After a schema change, restart the studio: a running Vite can serve a stale shared module.
- **Docker down.** `open -a OrbStack`, wait for `docker info`, then `pnpm backend:up`.
- **One runner only.** The root `pnpm dev` also starts a runner. Two runners with the same name double-run jobs, so check `ps` for a second `tsx watch src/main.ts` before a smoke test.
- **Crons by hand.** `npx convex run internal/schedule:writeDueScripts` writes tomorrow's scripts (and runs the last check); `npx convex run internal/schedule:morningSweep` writes each persona's brief and problem log. Read tables with `npx convex data <table> --order desc --limit N --format jsonl`.
- **Refusals.** An error the operator should read is thrown with `refusal()` from `packages/convex/src/lib/errors.ts`, and the studio shows it through `errorMessage` in `apps/studio/src/lib/errors.ts`. A plain `Error` reaches the screen as raw "[CONVEX M(...)] Server Error" text.
- **Where the build stands.** `docs/plan.md` "Progress" lists the slices done, the open questions for the operator and the slice 16 backlog. Update it with every slice. Slices 10 to 16 are built in the main session, without Workflow runs, at the operator's request.

## Branches

One branch, `main`. Commit there. No release flow yet: deploying is `pnpm --filter @influstep/app deploy` (wrangler) plus `pnpm --filter @influstep/convex deploy` once a cloud deployment exists. Do it only when asked.

## Architecture

- `apps/studio` — the operator app. Vite React SPA (TanStack Router, Tailwind v4, React Compiler) served by a Cloudflare Worker in `worker/`. The worker also serves `/go/:slug` (tracked-link click + redirect) and `/p/:handle` (link in bio).
- `apps/runner` — Node daemon on the operator's machine. Polls the backend for runner jobs (record, voice, render, upload, open browser), runs Playwright recipes against a persistent browser profile, writes artifacts to Convex storage.
- `packages/convex` — backend, layered like Formstep: `core/` domain rules (pipeline, planner, experiments, attribution), `private/` operator queries and mutations, `internal/` agent actions and job dispatch, `http/` routes for the worker and the runner, `providers/` adapters with mock and real implementations, `crons.ts`.
- `packages/shared` — types and pure helpers used by the app, the worker, the runner, and the backend (episode status machine, UTM builder, provider contracts).

`core/` holds the domain rules; handlers call into it. Statuses are discriminated unions. Tests run on Vitest; `packages/convex` uses `convex-test`.

## Conventions

- **React Compiler owns memoization.** `useMemo`, `useCallback`, and `React.memo` are lint errors outside tests; keep one only with a disable comment that says why.
- Code rules live in `.claude/skills/coding-rules/rules/`. Mechanical rules are oxlint errors (`.oxlintrc.json`, repo rules in `scripts/oxlint-plugin-studio.mjs`). High-impact ones: no silent fallbacks, one source of truth, early returns over `&&` chains, discriminated unions for state, types derived from schemas, no `any` or assertions outside boundaries.
- Commits follow `.claude/skills/commit/`: Conventional Commits with a product-language subject and a prose body. Stage explicit file paths only. Never `git stash`, `git reset --hard`, or `git checkout -- <path>`.
