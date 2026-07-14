# 022 — Retire the CLI and the GitHub Action

**Milestone:** M8 · **Depends on:** none (independent cleanup — built FIRST in the M8 sequence to shrink to a single app before auth lands) · **Spec:** this item + ADR-0013

## Goal

Vercel + Supabase is the sole deployment. Remove the CLI app and the
scheduled GitHub Action; the SQLite repository survives only as the fast
reference engine in the storage contract tests.

## Scope

- **Delete `apps/cli`** (composition root, text dashboard renderer, CLI
  entrypoint, its tests) and its `package.json`/build wiring. The web app
  is the only composition root.
- **Delete `.github/workflows/ingest.yml`** (the daily SQLite-committing
  Action) and remove the SQLite-artifact + `pnpm daily` machinery.
  `watchlist.json` stays for now only as the web cron's interim source
  until item 021 switches to union ingestion (then it goes too).
- **Keep** `packages/core/src/storage/repository.ts` (SQLite) + `schema.ts`
  and the two-engine `describeRepositoryContract` suite — SQLite is now
  purely the cheap reference proving the `StorageRepository` port against
  the Postgres implementation. Document that shift.
- **Collapse the twins**: harness/formatter code that was deliberately
  duplicated between `apps/cli` and `apps/web` (apps could not import apps)
  now has a single home in `apps/web`; remove the twin sync comments.
- **Lint/CI/docs**: simplify the dependency-cruiser rules that generalized
  across two apps; drop the CLI build from CI's build job (keep the web
  `next build` gate); rewrite README's Getting Started / Scheduled
  ingestion sections and `docs/deploy.md` for a Vercel-only world.

## Acceptance criteria

- [x] `apps/cli` and `.github/workflows/ingest.yml` removed; `pnpm build`,
      `pnpm test`, `pnpm lint`, `pnpm typecheck` all green.
- [x] The storage contract suite still runs against BOTH engines (SQLite
      reference + PGlite-Postgres); no drop in coverage.
- [x] No dangling references to the CLI/Action/`pnpm daily` in README,
      `docs/deploy.md`, or code comments (grep-clean).
- [x] Seam lint still enforces every surviving boundary (probe-verify the
      rules that changed).
