# ADR-0009: Throttled daily batch ingestion with ~1-year backfill

**Status:** Accepted — 2026-07-12

## Context
Kestrel is watchlist-driven. The Category-1 swing metric needs ~3 months of closes, plus headroom, so history must be backfilled. Free sources are rate-limited. The user explicitly accepts a small delay to stay under those limits.

## Decision
- **Daily batch run.** One throttled pass per day (not real-time).
- **~1-year (365-day) backfill** per instrument for headroom over the 63-day metric window.
- **Idempotent, resumable, throttled**: an inter-call delay (default ~1.5s) paces requests; instruments carry a `pending → backfilling → ready` state so a large watchlist can backfill across multiple runs, and a partial run resumes cleanly.
- **Cadence by data type:** closes daily; metadata (targets/earnings/dividends) on a weekly TTL — all within the single run.

## Consequences
- Stays under provider rate limits; interrupted runs resume without manual repair.
- Slow-but-correct: a big watchlist on a capped provider may take several days to fully backfill, which is acceptable.
- Not real-time — by design, this is an end-of-day screening tool.

## Alternatives considered
- **Real-time / high-frequency polling** — rejected: unnecessary for an EOD screener and invites rate-limit failures.
- **Overwrite-latest ingestion** — rejected: see ADR-0007 (append-only).
