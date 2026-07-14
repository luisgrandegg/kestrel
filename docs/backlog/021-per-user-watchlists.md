# 021 — Per-user watchlists + union ingestion

**Milestone:** M8 · **Depends on:** 020 · **Spec:** this item + ADR-0013

## Goal

Each signed-in user tracks their own set of tickers and sees screens over
just those — while the market data itself (prices, snapshots) stays shared
and is ingested once per ticker. Config/thresholds remain global.

## Scope

- **`user_watchlist(user_id, ticker)`** table behind the `StorageRepository`
  port (mutable bookkeeping, like `instruments` — not an observation).
  `user_id` is a **plain column holding better-auth's user id — a LOGICAL
  reference, not a DB-level foreign key**: better-auth's `user` table lives
  beside our storage seam (ADR-0013) and does not exist in the SQLite
  reference engine at all, so a real cross-schema FK could not be enforced
  under the two-engine contract suite. The ownership boundary (auth tables
  are better-auth's; this table is ours) is documented in code. Store
  method + contract tests against both engines.
- **Watchlist management UI** in `apps/web`: a signed-in user adds/removes
  tickers from their own watchlist (tickers normalized as in item 011).
  Adding a ticker no user tracked yet registers a new `instrument`
  (`pending`); removing the last user's hold on a ticker stops it being
  ingested (its history is retained, append-only).
- **Per-user dashboard**: the page evaluates screens over the requesting
  user's watchlist tickers only. The shared market data and global config
  drive the metrics; only the ticker SET is per-user.
- **Union ingestion**: the ingest route/worker fetches the UNION of all
  users' watchlist tickers (deduped, each ticker once) instead of
  `watchlist.json`. The `pending → backfilling → ready` lifecycle,
  throttle, idempotency, and resumability are unchanged. Retire
  `watchlist.json` as the ingestion source.
- **Kick a backfill on add** (decision, 2026-07-14): adding a ticker runs
  its backfill immediately (a throttled on-demand path — a single ticker is
  ~5 throttled calls, well inside a function's budget), rather than waiting
  for the next scheduled cron. Idempotent and resumable, so it composes with
  the cron: whichever runs first wins, the other is a no-op. The daily cron
  still sweeps the union for incremental refresh.
- **Empty-watchlist UX** (decision, 2026-07-14): a just-created user sees an
  explicit "add tickers to get started" empty state with the management UI
  front-and-centre.
- **No lookahead / append-only unchanged**: adding a user or ticker never
  rewrites history; a newly tracked ticker backfills like any new
  instrument.

## Acceptance criteria

- [ ] `user_watchlist` store contract green on SQLite and PGlite-Postgres.
- [ ] Two users with different watchlists see different dashboards over the
      SAME shared price/snapshot data (fixture test through the harness).
- [ ] Union ingestion fetches each ticker once regardless of how many users
      track it; a ticker tracked by nobody is not ingested (test).
- [ ] Adding a ticker kicks its backfill immediately; the on-add path and
      the cron are mutually idempotent (adding then a cron run does not
      duplicate; test).
- [ ] Dropping the last hold on a ticker stops ingestion but retains its
      stored history (append-only).
- [ ] Add/remove UI works end-to-end on a preview; per-user isolation holds
      (a user cannot see or edit another's watchlist).
