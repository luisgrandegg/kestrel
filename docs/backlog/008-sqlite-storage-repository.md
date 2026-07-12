# 008 — SQLite schema + repository

**Milestone:** M2 · **Depends on:** 003 · **Spec:** `MVP.md` §4, `CONSTITUTION.md` §3.1

## Goal

Append-only, as-of-dated storage behind a repository module that is the **only** code touching SQLite.

## Scope

- Schema exactly per `MVP.md` §4: `instruments`, `prices`, `analyst_snapshots`, `earnings_snapshots`, `dividend_snapshots`, with the pinned primary keys.
- Repository API:
  - Insert-or-ignore upserts for prices and all snapshot tables — writing an existing `(ticker, date)` / `(ticker, as_of)` is a no-op. **Never** `UPDATE`/`DELETE` a historical observation.
  - `latestSnapshot(ticker)` reads per snapshot table = `max(as_of)` row (a query, not an overwrite).
  - Price-series read for a ticker over a date range (feeds the fluctuation lookback).
  - Instrument reads/updates for lifecycle state and sync timestamps (`instruments` is the one mutable table — it holds state, not observations).
- No other module imports the SQLite driver (enforced by item 004's lint where possible).

## Acceptance criteria

- [x] Test: writing the same `(ticker, date)` price twice is a no-op (row count unchanged, value unchanged).
- [x] Test: writing the same `(ticker, as_of)` snapshot twice is a no-op.
- [x] Test: `latestSnapshot` returns the `max(as_of)` row while prior rows remain readable.
- [x] No `UPDATE`/`DELETE` paths exist for observation tables.
- [x] M2 Definition of Done satisfied.
