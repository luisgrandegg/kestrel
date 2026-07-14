# 021 — Per-user watchlists + union ingestion

**Milestone:** M8 · **Depends on:** 020 · **Spec:** this item + ADR-0013

## Goal

Each signed-in user tracks their own set of tickers and sees screens over
just those — while the market data itself (prices, snapshots) stays shared
and is ingested once per ticker. Config/thresholds remain global.

## Scope

- **`user_watchlist(user_id, ticker)`** table behind the `StorageRepository`
  port (mutable bookkeeping, like `instruments` — not an observation).
  `user_id` references better-auth's user id; the FK/ownership boundary is
  documented (auth tables are better-auth's, this table is ours). Store
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
- **No lookahead / append-only unchanged**: adding a user or ticker never
  rewrites history; a newly tracked ticker backfills like any new
  instrument.

## Open questions — decide before building

1. **Empty-watchlist UX:** a just-created user has no tickers — show an
   explicit "add tickers to get started" empty state (recommended) with the
   management UI front-and-centre.
2. **Ingestion trigger for a brand-new ticker:** wait for the next
   scheduled cron (recommended — simplest, consistent with the throttle),
   or kick a one-off backfill on add (faster feedback, more moving parts)?

## Acceptance criteria

- [ ] `user_watchlist` store contract green on SQLite and PGlite-Postgres.
- [ ] Two users with different watchlists see different dashboards over the
      SAME shared price/snapshot data (fixture test through the harness).
- [ ] Union ingestion fetches each ticker once regardless of how many users
      track it; a ticker tracked by nobody is not ingested (test).
- [ ] Dropping the last hold on a ticker stops ingestion but retains its
      stored history (append-only).
- [ ] Add/remove UI works end-to-end on a preview; per-user isolation holds
      (a user cannot see or edit another's watchlist).
