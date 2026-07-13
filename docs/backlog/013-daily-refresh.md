# 013 — Daily incremental refresh + metadata TTL

**Milestone:** M4 · **Depends on:** 012 · **Spec:** `MVP.md` §7, `CONSTITUTION.md` §3.3

## Goal

The steady-state daily run: fetch only what's missing, refresh slow-moving metadata on a TTL, stay throttled.

## Scope

- For each `ready` instrument:
  - **Incremental prices:** fetch only missing recent trading days — the cursor is `latestClose` (max stored date), never `last_price_sync`, which only records that a run happened. Weekends/holidays add nothing (dedupe by date).
  - **Metadata TTL:** refresh analyst/earnings/dividend snapshots only if `metadataTtlDays` (default 7) elapsed since `last_metadata_sync`.
- Same run continues backfill for any `pending`/`backfilling` instruments (item 012 logic).
- One throttled run per day; `interCallDelayMs` between calls throughout.
- Update `last_price_sync` / `last_metadata_sync` on the instrument row.
- Clock injected — nothing reads `Date.now()` directly (guardrail 2).

## Acceptance criteria

- [x] Test: a ticker current through yesterday fetches only the missing day(s).
- [x] Test: metadata untouched inside the TTL, refreshed (as a **new** snapshot row) once elapsed.
- [x] Test: running the daily refresh twice on the same day is a no-op.
- [x] Completing 011–013 satisfies the M4 Definition of Done.
