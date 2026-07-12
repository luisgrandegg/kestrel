# 016 — Screen 2: pre-earnings + undervalued

**Milestone:** M5 · **Depends on:** 014 · **Spec:** `MVP.md` §5.3, §6 row 2

## Goal

Category 2: undervalued instruments with an earnings report coming up inside the window.

## Scope

- **Event-proximity metric** (`MVP.md` §5.3), shared with item 017 — a pure function in `metrics/`:
  ```
  daysToEvent = eventDate − asOfDate   # calendar days; upcoming only (eventDate ≥ asOfDate)
  ```
  Past events never qualify. As-of date is an explicit parameter (guardrail 2).
- Predicate: `BASE AND 0 ≤ daysToEarnings ≤ earningsWindowDays` (default 14, from config).
- `requiredCapabilities: ['analystTargets', 'earningsCalendar', 'closes']`.
- Earnings date read from the **latest** `earnings_snapshots` row.
- Upcoming-only semantics: this front-runs the event; post-earnings drift is a separate future category, not a tweak here (`MVP.md` §6 note).
- Match output includes: impliedUpside %, daysToEarnings, next earnings date, numAnalysts.

## Acceptance criteria

- [ ] `daysToEvent` unit-tested: upcoming inside window, at the boundary (0 and `windowDays`), outside window, and **past date → excluded**.
- [ ] Given fixture storage, returns exactly the right matches.
- [ ] Screen disables with the missing capability named when `earningsCalendar` is unserved.
