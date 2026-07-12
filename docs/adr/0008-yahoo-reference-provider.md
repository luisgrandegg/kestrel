# ADR-0008: Yahoo (`yahoo-finance2`) as the MVP reference provider

**Status:** Accepted — 2026-07-12

## Context
The capability registry (ADR-0002) is source-agnostic, but the MVP must ship at least one working adapter to be runnable. The scarce capability is analyst **median target with an analyst count** (ADR-0005), which most free tiers omit or gate. The runtime target is Node/TS running in a scheduled GitHub Action.

## Decision
Ship a single reference adapter wrapping the **`yahoo-finance2`** library. Yahoo serves all four required capabilities together:
- `closes` via `chart()`
- `analystTargets` (median target + analyst count) via `quoteSummary` → `financialData`
- `earningsCalendar` and `dividendCalendar` via `quoteSummary` → `calendarEvents`

So all three screens light up at launch. The registry and adapter interface are still built for N providers.

## Consequences
- All screens functional on day one, with no API key; ~2 calls per ticker per run (trivial volume, 1-year backfill is one call/ticker).
- Node-native → drops straight into the Action pipeline, no Python subprocess.
- **Risk:** Yahoo is unofficial and scraping-backed; it can break without notice. This is isolated by the registry — when it breaks or is outgrown, swap the adapter, not the screens. Graduation path: split capabilities across keyed providers (e.g. Finnhub/Twelve Data for closes + earnings; FMP/Alpha Vantage for targets).

## Alternatives considered
- **Finnhub / FMP / Twelve Data / Alpha Vantage** — rejected for MVP: free tiers gate or omit median target + analyst count, or fail to cover all four capabilities from one source.
- **Multi-provider from day one** — deferred: unnecessary complexity for the MVP; the interface already supports it. An optional prices-only second adapter (e.g. Stooq) is the cheapest way to demo capability-merging if wanted.
