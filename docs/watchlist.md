# Managing the watchlist

The watchlist is `watchlist.json` at the repo root: a JSON array of ticker
symbols.

```json
["AAPL", "MSFT", "GOOGL"]
```

## Adding a ticker

1. Add the symbol to the array (any casing/whitespace — tickers are
   normalized to trimmed uppercase; entries that normalize to an already
   listed ticker are silently collapsed into it, first occurrence wins, so
   double-check the spelling of a new symbol).
2. Commit and push, then redeploy: the web app bundles `watchlist.json` at
   build time, so the edit takes effect once Vercel rebuilds (pushing to the
   connected branch triggers that). The next daily cron (`/api/ingest`,
   23:30 UTC) then registers the new instrument as `pending` and starts
   backfilling it.

A new instrument follows the `pending → backfilling → ready` lifecycle
(MVP.md §7): the throttled backfill may span several daily runs for a slow
or capped provider — a partial backfill is a valid state and resumes on the
next run. The instrument's screens start evaluating once it reaches
`ready` (history covers the configured fluctuation lookback).

To run the pipeline immediately instead of waiting for the schedule, hit
the route directly:
`curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/ingest`
— repeating a run on the same day is a no-op by design (idempotent, deduped
by UTC date).

> Backlog item 021 replaces this file-plus-redeploy flow with a per-user
> watchlist managed in the app (add/remove in the UI, backfill kicked on
> add). Until then the bundled `watchlist.json` remains the source.

## Removing a ticker

Remove the symbol from the array, then commit, push, and let Vercel
redeploy — like adding, the change only takes effect once the app rebuilds
(the watchlist is bundled at build time), not on the next cron fire. After
the redeploy the ticker stops being refreshed and screened. Its stored
history remains — storage is append-only and historical observations are
never deleted (CONSTITUTION.md §3.1); re-adding the ticker later resumes
from the data already on hand.
