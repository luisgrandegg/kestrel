# 006 — `completedFluctuations` metric

**Milestone:** M1 · **Depends on:** 005 · **Spec:** `MVP.md` §5.2, `CONSTITUTION.md` §3.2, §6

## Goal

Implement the percentage-ZigZag / directional-change algorithm as a **pure function** over an array of closes, until every item-005 test passes exactly.

## Scope

- Implement the reference algorithm from `MVP.md` §5.2: track direction and running extreme; a leg counts **only when the next ≥θ reversal confirms it**; the trailing pending leg is never counted, even past θ.
- Pure function: no storage, no network, no clock. Input is a chronological array of closes already sliced to the lookback window; θ is a parameter.
- Lookback slicing (`fluctuation.lookbackTradingDays`, default 63) applied by the caller or a thin wrapper — also pure, window size from config.

## Out of scope

- Intraday/OHLC swing detection (`MVP.md` §10 — closes only).
- Counting a trailing leg the instant it crosses θ (explicitly rejected in §5.2; do not "fix" this).

## Acceptance criteria

- [x] Every §5.2 acceptance test green, exactly.
- [x] `[100,112,98,113,99,114] → 4` with the trailing +15% leg demonstrably excluded.
- [x] Both monotonic cases return `0`.
- [x] No imports from `providers/` or `storage/`; no `Date.now()`.
- [x] θ and lookback come from parameters/config — no magic numbers (guardrail 5).
