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
providers → ingest → storage → metrics → screens → ui
(adapters)  (daily,   (SQLite/  (pure     (pure     (pure text
            throttled) Postgres, functions) predicates) renderer)
                       append-only)
```

- **Append-only storage.** Prices and metadata snapshots are observations:
  inserted once, never updated or deleted. "Latest" is a query, not an
  overwrite, and every read can be bounded by an explicit as-of date — so
  any screen result is reproducible after the fact.
- **No lookahead.** Metrics and screens see only data observed on or before
  the as-of date. The sanctioned wall-clock reads live in the
  composition-root entrypoints (the CLI entrypoint and the web app's
  page/route handlers); everything below them takes an injected date.
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

Every backlog item except the Yahoo adapter (010) is built and tested:
config, shared types, seam lint, all three metrics (implied upside;
completed-fluctuations ZigZag with pinned acceptance tests; event
proximity), append-only storage (SQLite and Supabase Postgres behind one
seam, one contract suite), provider registry, throttled
idempotent ingestion with a `pending → backfilling → ready` lifecycle, all
three screens, the dashboard renderer, and the scheduled GitHub Action.
M3 and M7 remain partially open exactly where they depend on that adapter.

**Not yet live:** the Yahoo Finance adapter awaits three open questions
recorded on backlog item 010 (plus one provisional default pending
sign-off on item 011), so no real provider is registered yet — scheduled
runs currently skip ingestion loudly and render every screen in its
disabled state.

## Getting started

Requires Node ≥ 22.13 and pnpm.

```sh
pnpm install
pnpm test        # 208 tests
pnpm lint        # biome + dependency-cruiser seam rules
pnpm typecheck
pnpm daily       # build + run the daily pipeline locally
```

The daily entrypoint (`node apps/cli/dist/cli.js [dbPath] [watchlistPath]
[dashboardPath] [configPath]`) ingests (when a provider is active), then
writes the rendered dashboard to `dashboard.md` and prints it.

## Configuration

Defaults follow `MVP.md` §9. Create `kestrel.config.json` at the repo root
to override any subset, e.g.:

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

`watchlist.json` at the repo root. See
[`docs/watchlist.md`](docs/watchlist.md) for how additions, removals, and
the backfill lifecycle behave.

## Scheduled ingestion

`.github/workflows/ingest.yml` runs the throttled daily pipeline at 23:30
UTC (well after the US close, tolerant of cron lag; same-day re-runs are
byte-identical no-ops) and commits the SQLite database and rendered
dashboard back to the repo.

## Deployment

The hosted target (ADR-0011) is the Next.js dashboard in `apps/web` on
Vercel, reading Supabase Postgres through the same storage seam, with the
ingest worker run by the app via a Vercel-Cron-invoked route
(`/api/ingest`, same 23:30 UTC slot). Step-by-step setup — Supabase
project + migration, Vercel import, `DATABASE_URL`/`CRON_SECRET`/
`KESTREL_CONFIG` env vars, cron verification — lives in
[`docs/deploy.md`](docs/deploy.md).

## Repository map

A pnpm/Turborepo workspace (ADR-0011): the workspace dependency direction is
`@kestrel/core` ← `@kestrel/ingest` ← the apps (`@kestrel/cli`,
`@kestrel/web`), and packages consume each other as TypeScript source via
package.json `exports`.

```
packages/
  core/            @kestrel/core — the pure domain (no workspace deps)
    src/
      config/      §9 defaults + validated overrides
      types/       shared DTOs, guards — the pure leaf every layer may import
      metrics/     impliedUpside, completedFluctuations, daysToEvent (pure)
      storage/     the seam contract (port) + repositories for both engines
                   (SQLite; Postgres/Supabase per ADR-0011, via a driverless
                   SQL-executor seam) — the only code that touches the
                   database; consumers type against the port
      screens/     the three category predicates + shared base predicate
      test-support/  test-only fixtures (outside the seam graph)
  ingest/          @kestrel/ingest — the worker library (depends on core)
    src/
      providers/   Provider interface, capability registry, and the active
                   adapter set (active.ts — adapters plug in here, once,
                   for every composition root)
      ingest/      backfill + daily refresh (state machine, throttle,
                   watchlist)
      test-support/  test-only fixtures (outside the seam graph)
apps/
  cli/             @kestrel/cli — composition root (depends on core + ingest)
    src/
      app/         harness, pipeline, CLI entrypoint
      ui/          dashboard renderer (pure text)
  web/             @kestrel/web — the hosted composition root (ADR-0011):
    src/           Next.js dashboard on Vercel over Supabase Postgres
      app/         page (HTML dashboard), /api/ingest cron route, and
                   _lib/ composition glue (pg-pool executor, pipeline)
supabase/
  migrations/ Postgres schema — the SQL twin of storage/schema.ts; the
              repository contract tests run against both engines
docs/
  backlog/    dependency-ordered build items with acceptance criteria
  adr/        decision records (background, not build instructions)
```
