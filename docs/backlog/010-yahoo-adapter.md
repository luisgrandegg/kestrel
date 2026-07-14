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

## Open questions — RESOLVED (owner, 2026-07-14; see ADR-0012)

1. **`asOf` stamping** → the adapter takes an injected clock at construction
   (`today: () => IsoDate`) and stamps every snapshot `asOf` with it. No
   `Date.now()` in the adapter (option 1).
2. **Missing vs. absent analyst target** → `getAnalystTargets` returns
   `AnalystSnapshot | null`; `null` when Yahoo clearly reports no coverage
   (ingestion writes no snapshot but still stamps `lastMetadataSync`). A
   malformed response (coverage reported, no usable target) still throws
   (a hybrid of options 1 and 2 — the snapshot is skipped, `medianTarget`
   stays non-nullable).
3. **Instrument currency** → a dedicated `Provider.getInstrumentInfo`
   surface, required by the `closes` capability; ingestion copies it via
   `setInstrumentCurrency` when currency is `NULL` (option 2 + 3).

The original framing is retained below for provenance.

### 1. Who stamps `asOf` on snapshots?

The `Provider` snapshot fetchers (MVP §3 verbatim) take no date but must return DTOs with a required `asOf`. The only in-adapter source is `Date.now()`, which the project bans elsewhere (guardrail 2; item 013 injects a clock) — and adapter-local time vs. ingestion-run date can disagree near midnight, producing duplicate `(ticker, as_of)` rows or snapshots dated ahead of their closes. Options: (1) adapters take an injected clock at construction, (2) the fetchers gain an `asOf` parameter, (3) ingestion re-stamps `asOf` over the adapter's return. Ask before implementing.

### 2. Missing vs. legitimately absent analyst target

"Missing target" has two readings the current design conflates: (a) the response is **malformed** → throw at the adapter (current rule), and (b) the ticker **legitimately has no analyst target**. The shared types cannot represent (b) for analyst targets — `AnalystSnapshot.medianTarget` is non-nullable — unlike earnings/dividends, where `null` means "none scheduled". If a covered-but-targetless instrument exists on the watchlist, its `analystTargets` fetch would re-fail every daily run. Options: (1) make `medianTarget` nullable + an explicit not-qualified reason in the metric, (2) skip writing a snapshot when no coverage exists, (3) keep throw-on-missing as designed. This is a spec ambiguity — ask before implementing (CLAUDE.md "when you're unsure").

### 3. Where does instrument currency travel?

This item's scope says adapters normalize "including instrument currency", but no shared DTO carries a currency field and the `Provider` interface (MVP §3 verbatim) has no surface that could return one — so `Repository.setInstrumentCurrency` has no possible production caller and `instruments.currency` stays `NULL` through promotion to `ready` (item 012's runner never touches it). Item 018 requires native-currency rendering (MVP §8), so this must be settled before 018. Options: (1) currency on a DTO (e.g. the `DailyClose` batch or a snapshot), (2) a dedicated `Provider` method/instrument-info call, (3) whichever surface is chosen, ingestion stamps `setInstrumentCurrency` from it (ingestion computes nothing — it may only copy). Whichever option wins adds a small follow-up to items 012/013. Ask before implementing.

## Acceptance criteria

- [x] Contract tests against recorded/mocked `yahoo-finance2` responses for all four capabilities. *(`providers/yahoo/yahoo.test.ts`, vi.mock — no live network.)*
- [x] Malformed-response fixtures throw at the adapter boundary, tested. *(missing timezone, missing quotes, non-positive close, future-dated close, missing financialData, coverage-without-target, missing currency — each throws with the ticker named.)*
- [x] Contract tests: the adapter echoes the requested ticker, returns zero-padded ISO dates, never returns future-dated closes, honors inclusive [from, to] bounds (returns the `to`-date bar when one exists), and partial/capped returns are the oldest contiguous slice (paginate oldest-first). *(Plus exchange-local date conversion via chart meta `exchangeTimezoneName`, not UTC-naive, and null-close bars dropped.)*
- [x] Lint proves no Yahoo identifier exists outside the adapter. *(`no-provider-library-outside-providers`; probe-verified: a yahoo-finance2 import outside `providers/` fails `pnpm lint:deps`.)*
- [x] Completing 009–010 satisfies the M3 Definition of Done. *(Registered in `providers/active.ts`; adapter serves all four capabilities plus currency.)*
