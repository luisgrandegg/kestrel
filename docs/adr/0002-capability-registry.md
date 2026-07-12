# ADR-0002: Capability registry for source-agnostic data

**Status:** Accepted — 2026-07-12

## Context
A core requirement is that the data source be swappable — Kestrel should fetch from any source. The three screens together need four distinct data types (daily closes, analyst targets, earnings dates, ex-dividend dates), and no single free source cleanly covers all four. A naive single-adapter design would force one provider to supply everything and would couple screens to that provider's shape.

## Decision
Decouple sources from logic via a **capability registry**:
- Providers **advertise** the capabilities they can serve; they don't know what screens exist.
- Screens **declare** the capabilities they require; they don't know which provider serves them.
- The registry resolves capability → provider at runtime, and may resolve different capabilities to different providers.
- A screen whose required capabilities aren't all served by an active provider is **auto-disabled and says which capability is missing** — never silently skipped, never fabricated.

This is backed by **hard pipeline seams** (ingestion → storage → metrics → screening → presentation); provider-specific details live only in adapters.

## Consequences
- Sources are swappable and **mixable** — closes from one provider, targets from another — with no change to screens or metrics.
- Graceful degradation: missing data disables a screen visibly instead of breaking the app.
- Cost: more upfront abstraction than a single adapter, and the registry/merge logic must be tested (including the disable path).

## Alternatives considered
- **Single swappable adapter behind one interface** — rejected: forces one provider to supply all four data types (which no free source does) and blocks per-capability mixing. The registry is designed for N providers even though the MVP ships one (see ADR-0008).
