# Managing your watchlist

Since item 021 (ADR-0013) the watchlist is **per-user** and managed in the
app — not a committed `watchlist.json` file. Each signed-in user tracks their
own set of tickers; the market data itself (prices, snapshots) is shared and
ingested once per ticker.

## Adding a ticker

On the dashboard, type a symbol into **Your watchlist → Add ticker** and
submit. Any casing/whitespace works — tickers are normalized to trimmed
uppercase, and adding one you already track is a no-op.

Adding a ticker:

1. Registers it as a `pending` instrument if no user tracked it yet.
2. Records it on your watchlist (`user_watchlist`, behind the storage port).
3. **Kicks an immediate throttled backfill** so it starts populating without
   waiting for the next daily cron. This is idempotent and resumable, so it
   composes with the cron — whichever runs first wins, the other is a no-op.

A new instrument follows the `pending → backfilling → ready` lifecycle
(MVP.md §7): the throttled backfill may span several runs for a slow or
capped provider — a partial backfill is a valid state and resumes next run.
Its screens start evaluating once it reaches `ready` (history covers the
configured fluctuation lookback).

## Removing a ticker

Click **remove** next to a ticker. It leaves your watchlist immediately. If
no other user tracks it, it drops out of the ingestion union and stops being
refreshed — but its stored history is retained (storage is append-only;
historical observations are never deleted, CONSTITUTION.md §3.1). Re-adding
it later resumes from the data already on hand.

## Per-user isolation

You only ever see and edit your own watchlist. Two users with different
watchlists see different dashboards over the same shared market data; config
and thresholds are global.

## Union ingestion

The daily cron (`/api/ingest`, 23:30 UTC) ingests the **union** of every
user's watchlist tickers, deduped — each ticker fetched once regardless of
how many users track it. See [`deploy.md`](deploy.md) for the schedule and
`CRON_SECRET`.
