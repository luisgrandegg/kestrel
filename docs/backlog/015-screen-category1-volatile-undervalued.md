# 015 — Screen 1: volatile + undervalued

**Milestone:** M5 · **Depends on:** 006, 014 · **Spec:** `MVP.md` §6 row 1

## Goal

Category 1: instruments that are undervalued per analysts **and** have swung sharply and repeatedly in the trailing window.

## Scope

- Predicate: `BASE AND completedFluctuations(θ, lookback) ≥ minOccurrences`.
- Config: `fluctuation.swingPct` (θ, default 0.10), `fluctuation.minOccurrences` (default 4), `fluctuation.lookbackTradingDays` (default 63) — all from item 002, none hardcoded.
- `requiredCapabilities: ['closes', 'analystTargets']`.
- Fluctuation counted over stored closes within the lookback window, as-of date explicit.
- Match output includes: impliedUpside %, medianTarget, latestClose, numAnalysts, completedFluctuations count (feeds item 018's row).

## Acceptance criteria

- [x] Given fixture storage, returns exactly the right matches (cases straddling both the upside threshold and the occurrence count).
- [x] An instrument passing BASE but with too few completed fluctuations is excluded, and vice versa.
- [x] Capabilities declared correctly; screen disables when `closes` or `analystTargets` is unserved.
