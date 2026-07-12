# 011 — Watchlist + instrument lifecycle

**Milestone:** M4 · **Depends on:** 008 · **Spec:** `MVP.md` §1, §7, `CONSTITUTION.md` §3.3

## Goal

A user-defined watchlist of tickers, and the `pending → backfilling → ready` (+ `error`) state machine that lets a large watchlist backfill across multiple runs.

## Scope

- Watchlist definition (e.g. a committed file) and registration: a new ticker becomes an `instruments` row in state `pending`.
- Lifecycle transitions as pure, testable logic:
  - `pending → backfilling` when ingestion starts on it.
  - `backfilling → ready` once history covers `lookbackTradingDays`.
  - `→ error` on repeated adapter failure (threshold explicit, not magic).
  - Partial backfill is a **valid state**, not an error.
- Removing a ticker from the watchlist stops future syncs but never deletes stored history (append-only).

## Acceptance criteria

- [ ] Adding a ticker to the watchlist creates a `pending` instrument; re-adding is a no-op.
- [ ] Transition rules unit-tested, including promotion-once-history-covers-lookback and the error path.
- [ ] No historical data is deleted on watchlist removal.
