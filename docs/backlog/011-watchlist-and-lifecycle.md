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

## Decisions recorded

- **Sticky `error`:** an instrument marked `error` is excluded from syncing and never auto-recovers; recovery is a manual intervention. MVP §7 is silent on recovery — item 012 owns the wiring (increment-on-failure, reset-on-success) and should revisit whether/when `error` instruments get retried, since a multi-day provider outage could otherwise freeze instruments on stale data.
- **`ingestion.maxConsecutiveFailures` (default 3):** the key is mandated by "threshold explicit, not magic"; the default value 3 was **signed off by the owner on 2026-07-14** (ADR-0012) — no longer provisional.
- **Ordering:** items 012/013 must call `registerWatchlist` before `syncableInstruments`; the latter fails loudly on listed-but-unregistered tickers.
- **Sequencing note:** this item (M4) was taken ahead of item 010 (M3), which was then blocked on its three recorded open questions — a deliberate deviation from the README's top-to-bottom order. Item 010 has since shipped (its questions and this item's `maxConsecutiveFailures` default were signed off 2026-07-14, ADR-0012).

## Acceptance criteria

- [x] Adding a ticker to the watchlist creates a `pending` instrument; re-adding is a no-op.
- [x] A ticker removed from the watchlist is not picked up by ingestion — **decision: ingestion drives off watchlist ∩ instruments** (no `archived` state, no schema migration; the instruments row and all history remain).
- [x] Transition rules unit-tested, including promotion-once-history-covers-lookback and the error path.
- [x] No historical data is deleted on watchlist removal.
