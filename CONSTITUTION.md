# CONSTITUTION — Kestrel

> Kestrel hovers, watches, and drops only when the moment is right. The tool does the same: a watchlist that waits and flags mechanically defined opportunities — nothing more.

This document defines the **durable invariants** of the system: the principles that must hold across every version and implementation choice. It governs *how* the tool may be built. Concrete formulas, defaults, and the first-slice scope live in `mvp.md` and are expected to evolve; the rules here are not.

If an implementation decision ever conflicts with this document, this document wins — or the conflict is escalated and resolved here before code is written.

---

## 1. Mission and stance

The tool surfaces **candidates to research**, never recommendations. It answers "which of the instruments I track currently match a mechanical definition of interesting?" — nothing more.

- Every screen is a **deterministic, mechanical predicate** over stored data. No opinions, no scoring black boxes, no "AI picks."
- Output is framed as candidates for the user's own further research. The system does not advise, rank by conviction, or imply an action.
- The tool never places orders, connects to a broker, or takes any real-world financial action.

## 2. Architectural invariants

### 2.1 Capability registry (the core contract)
Data sources are decoupled from the logic that consumes them via a capability registry.

- A **provider** advertises the set of **capabilities** it can serve (e.g. daily closes, analyst targets, earnings calendar, dividend calendar). It does not know what screens exist.
- A **screen** declares the set of capabilities it **requires**. It does not know which provider serves them.
- The registry resolves capabilities to providers at runtime. A capability may be served by different providers; a single provider may serve many capabilities.
- A screen whose required capabilities are not all served by some active provider is **automatically disabled**, and the reason is surfaced to the user (which capability is missing). It is never silently skipped and never fabricates data.

This contract is the reason the system is source-agnostic. It must never be short-circuited by a screen or metric reaching for a specific provider directly.

### 2.2 Hard pipeline seams
The system is built as five stages with strict boundaries. Data crosses a seam in one direction only; no stage reaches around another.

```
ingestion  →  storage  →  metrics  →  screening  →  presentation
```

- **Ingestion** fetches raw data through providers and writes it to storage. It computes nothing.
- **Storage** is the single source of truth. Everything downstream reads from storage, not from providers.
- **Metrics** compute derived values (upside, fluctuation counts, days-to-event) purely from stored data.
- **Screening** evaluates declarative predicates over metrics. It performs no I/O and no fetching.
- **Presentation** renders. It contains no business logic.

A metric or screen must be computable offline from storage alone. If it cannot, the missing input belongs in storage first.

### 2.3 Source agnosticism
No provider name, endpoint, field name, or quirk may appear anywhere outside that provider's adapter. Swapping or adding a provider must never require touching metrics, screens, storage schema, or presentation.

## 3. Data invariants

### 3.1 Append-only, as-of dated
All ingested data is stored append-only and stamped with the date it was observed ("as-of").

- Prices are a time series keyed by trading date.
- Slow-moving metadata (analyst targets, earnings dates, ex-dividend dates) is stored as **dated snapshots**, not overwritten. The system keeps history of how these values changed.
- This makes every screen result **reproducible after the fact** and leaves the door open to backtesting how a screen would have fired historically. Destroying prior values to store "just the latest" is prohibited.

### 3.2 Deterministic, reproducible metrics
Given the same stored inputs, a metric always returns the same output. Metrics must not depend on wall-clock time except through an explicit "as-of date" parameter, so that "what did this look like on date X" is always answerable.

### 3.3 Ingestion is idempotent, resumable, and throttled
- Re-running ingestion must never corrupt or duplicate data. Writing the same day twice is a no-op.
- A run interrupted partway (rate limit, crash, network) resumes cleanly on the next run with no manual repair.
- Every instrument carries an explicit lifecycle state so a large watchlist can be backfilled across multiple runs. A partial backfill is a valid intermediate state, not an error.
- The pipeline respects a configurable inter-call delay. Deliberately pacing requests to stay under provider limits is expected behaviour, not a failure. Slow-but-correct beats fast-but-throttled.

## 4. Configurability

Anything that encodes a judgement about what "interesting" means is a **parameter with a sensible default**, not a hardcoded constant. Thresholds (upside %, swing size, occurrence counts, event windows, lookbacks, delays) are configurable. Defaults live in one place, are documented, and are overridable without code changes.

## 5. Quality bars

- The fluctuation/swing-detection metric is the highest-risk piece of logic in the system and **must be covered by unit tests pinned to explicit worked examples** (see `mvp.md`). It may not ship without them.
- Provider adapters and the registry are covered by tests that assert the capability contract (including that a screen disables when a capability is absent).
- Data contracts between stages are explicitly typed. A provider returning malformed or partial data fails loudly at the adapter boundary, not three stages later.
- Numeric edge cases (insufficient history, zero/near-zero prices, missing analyst counts) are handled explicitly and never produce a silent wrong answer.

## 6. Non-goals and prohibitions

- No buy/sell/hold recommendations, conviction scores, or position sizing.
- No order execution or broker integration.
- No lookahead: a metric evaluated as-of date X may only use data observed on or before X.
- No provider-specific logic outside adapters.
- No overwriting of historical observations.
- No silent degradation: missing capabilities disable screens visibly; they never cause fabricated or stale-presented-as-fresh results.
