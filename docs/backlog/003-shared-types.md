# 003 — Shared types and DTOs

**Milestone:** M0 · **Depends on:** 001 · **Spec:** `MVP.md` §3, `CONSTITUTION.md` §5

## Goal

The explicitly-typed data contracts every seam exchanges, so a provider returning malformed data can fail loudly at the adapter boundary.

## Scope

- `Capability = 'closes' | 'analystTargets' | 'earningsCalendar' | 'dividendCalendar'`.
- DTOs: `DailyClose`, `AnalystSnapshot`, `EarningsSnapshot`, `DividendSnapshot` (fields mirroring the storage schema in `MVP.md` §4: median target + analyst count, next earnings date, next ex-dividend date, all as-of dated).
- `IsoDate` (or equivalent) type for dates.
- Instrument lifecycle state type: `'pending' | 'backfilling' | 'ready' | 'error'`.
- Types are provider-agnostic: **no Yahoo field names** anywhere in them.

## Acceptance criteria

- [x] All four capability names and four DTOs exist and compile.
- [x] No provider-specific naming appears in shared types (guardrail 1 / `CONSTITUTION.md` §2.3).
