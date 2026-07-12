# 017 — Screen 3: pre-ex-dividend + undervalued

**Milestone:** M5 · **Depends on:** 016 · **Spec:** `MVP.md` §5.3, §6 row 3

## Goal

Category 3: undervalued instruments with an ex-dividend date coming up inside the window.

## Scope

- Predicate: `BASE AND 0 ≤ daysToExDiv ≤ exDivWindowDays` (default 14, from config).
- Reuses the `daysToEvent` metric from item 016 — same upcoming-only, calendar-day semantics.
- `requiredCapabilities: ['analystTargets', 'dividendCalendar', 'closes']`.
- Ex-dividend date read from the **latest** `dividend_snapshots` row.
- Match output includes: impliedUpside %, daysToExDiv, next ex-div date, numAnalysts.

## Acceptance criteria

- [ ] Given fixture storage, returns exactly the right matches, including boundary and past-date exclusion cases.
- [ ] Screen disables with the missing capability named when `dividendCalendar` is unserved.
- [ ] Completing 014–017 satisfies the M5 Definition of Done.
