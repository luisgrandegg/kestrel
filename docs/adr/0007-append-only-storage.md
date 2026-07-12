# ADR-0007: Append-only, as-of-dated storage

**Status:** Accepted — 2026-07-12

## Context
Prices are inherently a time series. Analyst targets, earnings dates, and ex-dividend dates change over time too. Storing only the latest value of the slow-moving metadata would make past screen results irreproducible and foreclose any later backtesting or drift analysis.

## Decision
Store **everything append-only**, stamped with the date it was observed ("as-of"):
- Prices keyed by trading date.
- Analyst / earnings / dividend data kept as **dated snapshots**, never overwritten.
- "Latest" is a `max(as_of)` query, not an in-place update.

## Consequences
- Screen results are reproducible after the fact; "what did this look like on date X" is answerable.
- Enables seeing analyst-target drift and backtesting screens later.
- Ingestion idempotency falls out naturally (insert-or-ignore).
- Costs more storage than latest-only, and reads must explicitly select the latest snapshot.

## Alternatives considered
- **Latest-only (overwrite) storage** — rejected: destroys history, blocks reproducibility and backtesting, and discards the target-drift signal.
