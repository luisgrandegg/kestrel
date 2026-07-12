# 010 — Yahoo adapter (`yahoo-finance2`)

**Milestone:** M3 · **Depends on:** 009 · **Spec:** `MVP.md` §2, `CONSTITUTION.md` §2.3, §5, `CLAUDE.md` guardrails 1 & 6

## Goal

The one MVP adapter, wrapping `yahoo-finance2`, serving all four capabilities and normalising Yahoo's shape into the shared DTOs. Every Yahoo-specific detail lives here and nowhere else.

## Scope

Capability mapping per `MVP.md` §2:

| Capability | Yahoo source |
|---|---|
| `closes` | `chart()` daily close series |
| `analystTargets` | `quoteSummary` → `financialData.targetMedianPrice`, `numberOfAnalystOpinions` |
| `earningsCalendar` | `quoteSummary` → `calendarEvents.earnings.earningsDate` |
| `dividendCalendar` | `quoteSummary` → `calendarEvents.exDividendDate` / `summaryDetail.exDividendDate` |

- Normalise into `DailyClose`, `AnalystSnapshot`, `EarningsSnapshot`, `DividendSnapshot` — including instrument currency.
- **Fail loud at the adapter edge:** malformed or partial Yahoo responses (missing target, missing dates, non-positive or non-finite closes) throw here, not three stages downstream. Storage is append-only, so a bad close that slips through can never be removed — the positivity contract on `DailyClose.close` must be enforced here.
- No Yahoo field name, endpoint, or quirk escapes `providers/yahoo/` (lint-enforced by item 004).

## Acceptance criteria

- [ ] Contract tests against recorded/mocked `yahoo-finance2` responses for all four capabilities.
- [ ] Malformed-response fixtures throw at the adapter boundary, tested.
- [ ] Lint proves no Yahoo identifier exists outside the adapter.
- [ ] Completing 009–010 satisfies the M3 Definition of Done.
