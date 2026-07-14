# ADR-0012: Yahoo adapter — asOf clock, nullable analyst coverage, currency surface, failure threshold

**Status:** Accepted — 2026-07-14

## Context

Building the one MVP adapter (backlog item 010, ADR-0008 — `yahoo-finance2`)
surfaced three open questions recorded on that item, plus a provisional
default awaiting sign-off on item 011. The owner resolved all four on
2026-07-14; this records them.

1. **Who stamps `asOf` on snapshots?** The `Provider` snapshot fetchers
   (MVP.md §3, verbatim) take no date but must return DTOs with a required
   `asOf`. The only in-adapter source is `Date.now()`, which the project
   bans (guardrail 2) — and adapter-local time vs. the ingestion-run date
   can disagree near midnight, producing duplicate `(ticker, as_of)` rows.

2. **Missing vs. legitimately absent analyst target.** `AnalystSnapshot`
   has no null representation (unlike earnings/dividends, where `null` means
   "none scheduled"). A covered-but-targetless or genuinely-uncovered
   instrument would otherwise either be fabricated or re-fail every daily
   run at the "missing target ⇒ throw" rule.

3. **Where does instrument currency travel?** The scope says the adapter
   normalizes "including instrument currency", but no shared DTO carries a
   currency and the `Provider` interface has no surface that returns one —
   so `Repository.setInstrumentCurrency` had no production caller and
   `instruments.currency` stayed `NULL` (blocking item 018's native-currency
   rendering, MVP.md §8).

4. **`ingestion.maxConsecutiveFailures`** was gap-filled at `3` (MVP.md §7
   requires an "error on repeated adapter failure" rule but §9 lists no key),
   marked provisional pending sign-off on item 011.

## Decision

1. **Injected clock.** `YahooProvider` takes `{ today: () => IsoDate }` at
   construction and stamps every snapshot's `asOf` with it. No `Date.now()`
   inside the adapter; the composition roots inject the same run date they
   pass to ingestion, so a snapshot can never be dated ahead of the run.

2. **Nullable analyst return.** `Provider.getAnalystTargets` returns
   `Promise<AnalystSnapshot | null>`. `null` means Yahoo **clearly** reports
   no coverage (`numberOfAnalystOpinions` absent or `0` **and** no usable
   median target). Ingestion then writes no analyst snapshot but **still
   stamps `lastMetadataSync`**, so an uncovered ticker is not refetched
   before its TTL and never error-loops. A **malformed** response —
   analysts `> 0` but the target missing or non-finite — still **throws** at
   the adapter edge (guardrail 6). `AnalystSnapshot.medianTarget` stays
   non-nullable: absence is represented by the absent snapshot, not a null
   field, so the storage schema and metric are unchanged.

3. **Dedicated currency surface.** A fifth `Provider` method
   `getInstrumentInfo(ticker): Promise<{ ticker: string; currency: string }>`,
   **required by the `closes` capability** — `CAPABILITY_METHODS.closes` now
   lists both `getCloses` and `getInstrumentInfo`, so a provider serving
   `closes` must back both or fail loud at registration. Ingestion **copies**
   the currency (`setInstrumentCurrency`) through the shared throttle when an
   instrument's currency is `NULL`, on both the backfill promotion path and
   the daily refresh path — copy only, never compute (CONSTITUTION.md §2.2);
   a fetch failure is charged as a provider failure like any other.

4. **`maxConsecutiveFailures: 3` is signed off** as the durable default
   (decided 2026-07-14) — no longer provisional.

## Consequences

- Two **deliberate deviations from MVP.md §3's pinned `Provider` surface**,
  both recorded here as the authoritative decision:
  - `getAnalystTargets` returns `AnalystSnapshot | null` (was
    `AnalystSnapshot`).
  - a fifth method, `getInstrumentInfo`, joins the four §3 fetchers.
- `CAPABILITY_METHODS` values became `readonly string[]` (a capability may
  require several methods); the registry's registration loop iterates them.
  The registry's resolution semantics (`providersFor`/`isServed`/
  `resolveScreen`) are unchanged.
- Every provider advertising `closes` (including every test fake) must now
  implement `getInstrumentInfo`; the registry rejects one that does not.
- The adapter converts intraday close timestamps to the **exchange-local**
  calendar date (chart meta `exchangeTimezoneName`), never UTC-naive, so a
  bar is never mis-dated by a day. Calendar-event dates (earnings, ex-div)
  are day-granularity scheduling dates and are converted **UTC-naive**,
  consistent with the pipeline's UTC calendar dates (`utcIsoDate`); the
  exchange-tz conversion is reserved for the intraday close series where it
  is load-bearing.
- Currency for `getInstrumentInfo` is read from `quoteSummary` →
  `price.currency` (a standalone lightweight call, independent of any price
  window), not chart meta.

## Alternatives considered

- **`asOf` as a fetcher parameter, or ingestion re-stamping the adapter's
  return** — rejected: the injected clock keeps the fetcher signatures close
  to MVP.md §3 and puts the single run-date source at the composition root,
  matching how ingestion already receives `today`.
- **Making `AnalystSnapshot.medianTarget` nullable** — rejected: it would
  ripple a nullable through the schema and the implied-upside metric; a null
  return (no snapshot) localizes "no coverage" to ingestion.
- **Currency on the `DailyClose` batch or a snapshot DTO** — rejected: it
  overloads an observation DTO with instrument metadata; a dedicated
  instrument-info surface keeps the currency copy explicit and one-shot.
