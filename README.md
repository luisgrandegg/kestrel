# Kestrel

A watchlist that waits. Kestrel ingests daily market data for a small,
personal watchlist and mechanically flags three kinds of situations worth a
closer look:

| # | Screen | Flags instruments that are… |
|---|--------|------------------------------|
| 1 | Volatile + undervalued | undervalued per analyst consensus **and** swinging sharply and repeatedly in the trailing window |
| 2 | Pre-earnings + undervalued | undervalued **with** an earnings report coming up inside the window |
| 3 | Pre-ex-dividend + undervalued | undervalued **with** an ex-dividend date coming up inside the window |

Everything it shows is a **research candidate, never a recommendation** —
each match carries the numbers behind it (implied upside, analyst count,
swing count, event dates) so you can do your own work. Nothing here is
investment advice.

## How it works

```
providers → ingest → storage → metrics → screens → dashboard
(adapters)  (daily,   (Postgres/ (pure     (pure      (HTML page,
            throttled) SQLite,   functions) predicates) apps/web)
                       append-only)
```

- **Append-only storage.** Prices and metadata snapshots are observations:
  inserted once, never updated or deleted. "Latest" is a query, not an
  overwrite, and every read can be bounded by an explicit as-of date — so
  any screen result is reproducible after the fact.
- **No lookahead.** Metrics and screens see only data observed on or before
  the as-of date. The sanctioned wall-clock reads live in the
  composition-root entrypoints (the web app's dashboard page and cron
  route handlers); everything below them takes an injected date.
- **Capabilities gate screens.** A screen whose data needs aren't served by
  an active provider renders a visible "unavailable — missing capability: X"
  state. It is never hidden and never fed fabricated or stale data.
- **No hardcoded judgement.** Every threshold (upside %, swing size, event
  windows, analyst minimum) comes from config via `kestrel.config.json`;
  the upside threshold is overridable per screen.
- **Seams are lint-enforced.** dependency-cruiser rules fail CI if any layer
  reaches around another (e.g. screens importing providers, UI importing
  storage).

The spec lives in [`CONSTITUTION.md`](CONSTITUTION.md) (durable invariants)
and [`MVP.md`](MVP.md) (the concrete first slice). Work is tracked as
dependency-ordered items in [`docs/backlog/`](docs/backlog/).

## Status

The MVP is feature-complete: config, shared types, seam lint, all three
metrics (implied upside; completed-fluctuations ZigZag with pinned acceptance
tests; event proximity), append-only storage (Supabase Postgres and SQLite
behind one seam, one contract suite), provider registry, throttled idempotent
ingestion with a `pending → backfilling → ready` lifecycle, all three screens,
the dashboard, and the Yahoo Finance adapter (010) — which serves all four
capabilities plus native currency.

Kestrel now targets a single deployment — the Next.js app in `apps/web` on
Vercel over Supabase Postgres, with ingestion run by the app itself via a
Vercel-Cron route. The standalone CLI and the SQLite-committing GitHub Action
have been retired (ADR-0013); the SQLite repository survives only as the fast
reference engine that proves the storage port in the contract tests.

The dashboard is **private** and **per-user** (items 020–021, ADR-0013):
sign-in is via [better-auth](https://better-auth.com) with Google, and users
are auto-created on first sign-in (identities linked by verified email). A
method whose OAuth secrets are absent is not offered — the sign-in page says
so honestly rather than showing a broken button. Session durations come from
config (`auth.sessionAbsoluteHours`/`sessionSlidingHours`). Each user manages
their own watchlist in the app (adding a ticker kicks an immediate backfill);
the **market data is shared** and ingested once per ticker, with the daily
cron fetching the **union** of everyone's tickers. Config/thresholds stay
global. See [`docs/deploy.md`](docs/deploy.md) for the Google + `BETTER_AUTH_*`
setup.

**Live:** the Yahoo adapter is registered in
`packages/ingest/src/providers/active.ts`, so scheduled runs ingest live
market data and every screen is enabled. The three open questions on item 010
and item 011's failure-threshold default were signed off on 2026-07-14
(ADR-0012). Yahoo is unofficial and scraping-backed (ADR-0008): if it breaks,
provider fetches fail loud and are charged to each instrument's failure streak
(sticky `error` after the configured threshold) — never fabricated or stale
data — and the fix is swapping the adapter behind the registry, not the
screens.

## Getting started

Requires Node ≥ 22.13 and pnpm.

```sh
pnpm install
pnpm test        # unit + storage-contract + web-harness suites
pnpm lint        # biome + dependency-cruiser seam rules
pnpm typecheck
pnpm build       # turbo build, including apps/web's `next build`
```

To run the app locally, `cd apps/web` and use the Next.js dev server; it
reads Supabase Postgres through the storage seam and runs ingestion via the
`/api/ingest` route. Environment setup is in [`docs/deploy.md`](docs/deploy.md).

## Configuration

Defaults follow `MVP.md` §9. To override any subset, set the `KESTREL_CONFIG`
env var to a JSON object (there is no repo-root cwd on Vercel, so the
deployed app reads config from the environment, not a file):

```json
{
  "minAnalysts": 5,
  "screens": { "category1": { "upsideThreshold": 0.4 } },
  "fluctuation": { "swingPct": 0.1, "minOccurrences": 4, "lookbackTradingDays": 63 },
  "earnings": { "windowDays": 14 },
  "exDividend": { "windowDays": 14 }
}
```

Unknown keys and out-of-range values fail loudly — a typo'd config never
silently falls back to defaults.

## The watchlist

Each signed-in user manages their own watchlist in the app (item 021) —
stored behind the storage seam (`user_watchlist`), not a committed file.
Adding a ticker kicks an immediate backfill; the daily cron ingests the
union of every user's tickers. See [`docs/watchlist.md`](docs/watchlist.md)
for how additions, removals, and the backfill lifecycle behave.

## Scheduled ingestion

A Vercel Cron hits the `/api/ingest` route at 23:30 UTC (well after the US
close, tolerant of cron lag; the throttled pipeline is idempotent and
resumable, so a same-day re-run or a mid-run timeout simply resumes). The
route is machine-authenticated with `CRON_SECRET` and writes straight to
Supabase Postgres through the storage seam. There is no self-committing
GitHub Action — ingestion belongs to the deployed app (ADR-0013).

## Deployment

The sole deployment (ADR-0011, ADR-0013) is the Next.js dashboard in
`apps/web` on Vercel, reading Supabase Postgres through the storage seam,
with the ingest worker run by the app via the Vercel-Cron-invoked
`/api/ingest` route. Step-by-step setup — Supabase project + migration,
Vercel import, `DATABASE_URL`/`CRON_SECRET`/`KESTREL_CONFIG` env vars, cron
verification — lives in [`docs/deploy.md`](docs/deploy.md).

## Repository map

A pnpm/Turborepo workspace (ADR-0011): the workspace dependency direction is
`@kestrel/core` ← `@kestrel/ingest` ← `@kestrel/web`, and packages consume
each other as TypeScript source via package.json `exports`.

```
packages/
  core/            @kestrel/core — the pure domain (no workspace deps)
    src/
      config/      §9 defaults + validated overrides
      types/       shared DTOs, guards — the pure leaf every layer may import
      metrics/     impliedUpside, completedFluctuations, daysToEvent (pure)
      storage/     the seam contract (port) + repositories for both engines
                   (Postgres/Supabase per ADR-0011, via a driverless
                   SQL-executor seam — the deployed engine; SQLite is the
                   fast reference engine that proves the port in the
                   contract tests) — the only code that touches the
                   database; consumers type against the port
      screens/     the three category predicates + shared base predicate
      test-support/  test-only fixtures (outside the seam graph)
  ingest/          @kestrel/ingest — the worker library (depends on core)
    src/
      providers/   Provider interface, capability registry, and the active
                   adapter set (active.ts — the one place adapters plug in)
      ingest/      backfill + daily refresh (state machine, throttle,
                   watchlist)
      test-support/  test-only fixtures (outside the seam graph)
apps/
  web/             @kestrel/web — the sole composition root (ADR-0011, 0013):
    src/           Next.js dashboard on Vercel over Supabase Postgres
      app/         page (private, per-user dashboard) + sign-in page +
                   watchlist manager + api/ingest cron route + api/auth/*
                   (better-auth) = presentation; _lib/ composition glue
                   (pg-pool executor, pipeline, screen-evaluation harness,
                   formatters, auth instance, watchlist server actions)
supabase/
  migrations/ 00001_init.sql (market data — the SQL twin of storage/schema.ts;
              the repository contract tests run against both engines),
              00002_auth.sql (better-auth's own user/session/account tables),
              00003_user_watchlist.sql (per-user watchlists)
docs/
  backlog/    dependency-ordered build items with acceptance criteria
  adr/        decision records (background, not build instructions)
```
