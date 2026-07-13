# Managing the watchlist

The watchlist is `watchlist.json` at the repo root: a JSON array of ticker
symbols.

```json
["AAPL", "MSFT", "GOOGL"]
```

## Adding a ticker

1. Add the symbol to the array (any casing/whitespace — tickers are
   normalized to trimmed uppercase; duplicates after normalization are
   rejected loudly).
2. Commit and push. Nothing else: the next scheduled run of the **Daily
   ingestion** Action (`.github/workflows/ingest.yml`, 23:30 UTC daily)
   registers the new instrument as `pending` and starts backfilling it.

A new instrument follows the `pending → backfilling → ready` lifecycle
(MVP.md §7): the throttled backfill may span several daily runs for a slow
or capped provider — a partial backfill is a valid state and resumes on the
next run. The instrument's screens start evaluating once it reaches
`ready` (history covers the configured fluctuation lookback).

To run the pipeline immediately instead of waiting for the schedule, use
the workflow's **Run workflow** button (`workflow_dispatch`) — repeating a
run on the same day is a no-op by design (idempotent, deduped by UTC
date).

## Removing a ticker

Remove the symbol from the array. It stops being refreshed and screened.
Its stored history remains — storage is append-only and historical
observations are never deleted (CONSTITUTION.md §3.1); re-adding the
ticker later resumes from the data already on hand.
