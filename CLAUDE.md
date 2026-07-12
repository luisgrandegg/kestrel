# CLAUDE.md — Kestrel Build Guide

Operating instructions for building Kestrel. This file governs *how you work*; it does not redefine *what to build*. The two source-of-truth documents are:

- **`constitution.md`** — durable invariants. Never violate these.
- **`mvp.md`** — the concrete first slice: formulas, defaults, data model, acceptance tests.

Decision provenance (why choices were made) lives in `docs/adr/`. It is background for humans, **not** build instructions — do not act on it or treat it as authoritative.

**Authority order when anything conflicts:** `constitution.md` > `mvp.md` > this file > your own judgement. If you find a genuine contradiction between the two source docs, **stop and ask** — do not silently pick one.

Before writing any code, read both documents in full.

---

## How to work

- **Build in the milestone order below.** Each milestone is dependency-ordered so that the riskiest, most testable logic lands first and nothing is built on an untested foundation.
- **Test-first for all metrics.** The fluctuation metric especially: write the acceptance tests from `mvp.md` §5.2 *before* the implementation, and do not move past Milestone 1 until they pass exactly.
- **One milestone at a time.** Finish it, get its tests green, confirm its Definition of Done, commit, then continue.
- **When the spec is ambiguous or you're tempted to cross a seam, stop and ask** rather than guessing. A wrong guess that violates an invariant is more expensive than a question.
- **Prefer slow-but-correct.** The ingestion throttle is a feature, not a bottleneck to optimise away.

## Non-negotiable guardrails

These are the constitution's invariants stated as operational rules. Treat a violation as a build failure.

1. **Seam boundaries are import boundaries.**
   - `metrics/` and `screens/` import from `storage/` only. They must **never** import from `providers/`.
   - Only files in `providers/<name>/` may reference the underlying library (`yahoo-finance2`) or any Yahoo field name, endpoint, or quirk. If a Yahoo-specific string appears anywhere else, it's a bug.
   - Add a dependency-boundary lint rule (e.g. `eslint-plugin-import` / `dependency-cruiser`) that fails CI if these are crossed. Wire it in Milestone 0.

2. **No lookahead.** Every metric takes an explicit as-of date and may use only data observed on or before it. No metric reads `Date.now()` directly — inject a clock.

3. **Append-only storage.** Prices and metadata snapshots are insert-or-ignore. Never `UPDATE`/`DELETE` a historical observation. "Latest" is a query (`max(as_of)`), not an overwrite.

4. **Capabilities gate screens.** A screen whose required capabilities aren't all served by an active provider is disabled and says which capability is missing. Never fabricate, never silently skip, never present stale data as fresh.

5. **No hardcoded judgement.** Every threshold comes from config (`mvp.md` §9). No magic numbers in metrics or screens.

6. **Fail loud at the adapter edge.** A provider returning malformed/partial data throws at the adapter boundary, not three stages downstream.

7. **Idempotent + resumable ingestion.** Re-running never duplicates or corrupts. A crashed run resumes cleanly next time.

## Milestones

### M0 — Scaffold
Repo, TypeScript, test runner, config module with the `mvp.md` §9 defaults, shared types (`Capability`, `DailyClose`, `AnalystSnapshot`, `EarningsSnapshot`, `DividendSnapshot`), and the dependency-boundary lint rule (guardrail 1).
**DoNE:** `npm test` runs; an intentional cross-seam import fails lint.

### M1 — Metrics (pure, test-first) ⟵ highest risk, do first
Implement `impliedUpside` and `completedFluctuations` as pure functions over fixtures — no storage, no network.
- Write the `mvp.md` §5.2 acceptance table as tests **first**.
- Implement the percentage-ZigZag confirm-on-reversal algorithm until all five cases pass **exactly**, including `[100,112,98,113,99,114] → 4` (trailing +15% leg excluded) and the two monotonic `→ 0` cases.
- Add edge cases: `< 2` closes, zero/near-zero price, `numAnalysts` below gate.
**DONE:** every §5.2 case green; the "count only completed" semantics demonstrably hold (a trailing leg past θ is not counted).

### M2 — Storage
Schema + a repository module that is the only code touching SQLite. Insert-or-ignore upserts; `latestSnapshot` / price-series reads.
**DONE:** writing the same `(ticker,date)` / `(ticker,as_of)` twice is a no-op; latest-snapshot query returns `max(as_of)`; tests prove both.

### M3 — Providers + registry
`Provider` interface, the registry (capability → ordered providers; screen-disable resolution), and the Yahoo adapter mapping the four capabilities per `mvp.md` §2. Adapter normalises Yahoo's shape into the shared DTOs and throws on malformed data.
**DONE:** contract tests pass, including: a screen with an unserved capability is reported disabled; no Yahoo field name exists outside the adapter (lint-enforced).

### M4 — Ingestion
Backfill + daily refresh with the `pending → backfilling → ready` state machine, `interCallDelayMs` throttle, incremental price fetch, metadata TTL, and resumable partial backfill.
**DONE:** idempotency and mid-run-resume tests pass; a capped/slow provider backfills across multiple runs without duplication.

### M5 — Screening
The three screens as declarative predicates over metrics, each exposing `requiredCapabilities`. Base predicate shared; `upsideThreshold` configurable per screen. No I/O in this layer.
**DONE:** given fixture storage, each screen returns the right matches; disabled-screen path works end-to-end with the registry.

### M6 — Presentation
Dashboard grouped by category with the supporting numbers from `mvp.md` §8, native currency, disabled-screen state, research-candidates framing.
**DONE:** all three categories render with their per-row fields; a disabled screen shows the missing capability.

### M7 — Scheduling
Wire ingestion into a scheduled GitHub Action (UTC cron well after US close; tolerate cron lag; dedupe by date). Document how to add tickers to the watchlist.
**DONE:** the Action runs the throttled daily pipeline and persists results.

## Definition of Done (whole MVP)

- All three screens evaluate and render, driven only by stored data.
- Metrics match the pinned acceptance tests; no metric touches the network or the clock directly.
- No module outside `providers/` references Yahoo; swapping the adapter would not touch metrics, screens, storage, or UI.
- Ingestion is idempotent, resumable, throttled; the watchlist backfills and stays current.
- Historical observations are never overwritten.
- Everything in `mvp.md` §10 stayed out of scope.

## When you're unsure

Ask before you: cross a seam, hardcode a threshold, overwrite historical data, add a capability/provider not in the MVP, or reinterpret the fluctuation semantics. These are exactly the places where a plausible-looking shortcut breaks an invariant.
