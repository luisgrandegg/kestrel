# 012 — Throttled, resumable backfill

**Milestone:** M4 · **Depends on:** 010, 011 · **Spec:** `MVP.md` §7, `CONSTITUTION.md` §3.3, `CLAUDE.md` guardrail 7

## Goal

Backfill ~1 year (`backfillLookbackDays`, default 365) of daily closes per instrument, throttled, idempotent, and resumable mid-run.

## Scope

- For each `pending`/`backfilling` instrument: fetch history in throttled chunks toward `backfillLookbackDays`; promote to `ready` once history covers `lookbackTradingDays` (per item 011's rules).
- Sleep `interCallDelayMs` (config, default 1500) between **all** provider calls. The throttle is a feature — do not optimise it away.
- Writes go through the repository's insert-or-ignore, so re-running never duplicates.
- A crash mid-run leaves consistent state; the next run picks up where it left off with no manual repair.
- Initial metadata snapshots (analyst targets, earnings, ex-dividend) fetched as part of bringing an instrument up.
- Ingestion computes nothing — it fetches and writes (seam rule, `CONSTITUTION.md` §2.2).

## Failure accounting (from item 011's review)

The runner wires the persistent failure streak: `Repository.incrementFailures` on each adapter failure, feeding `recordFailure` for the error transition at `ingestion.maxConsecutiveFailures`; `resetFailures` on any successful fetch. Whether/when `error` instruments are retried is a design point to settle here (sticky-error decision recorded on item 011).

## Acceptance criteria

- [x] Idempotency test: running backfill twice produces identical storage (row counts unchanged).
- [x] Mid-run-resume test: kill/abort partway, re-run, end state correct with no duplicates.
- [x] A capped/slow fake provider backfills across multiple runs without duplication.
- [x] Inter-call delay verifiably applied (injectable sleep/clock for tests).
- [x] Failure accounting: increment-on-failure / reset-on-success / demote-at-threshold, tested across simulated runs.
