# ADR-0006: Event screens are upcoming-only; post-earnings drift deferred

**Status:** Accepted — 2026-07-12

## Context
Categories 2 and 3 fire when a name is near an earnings date or an ex-dividend date. A screen could match on the approach to the event (front-running) or on either side of it (including the aftermath). The two represent different theses.

## Decision
Both event screens use **upcoming-within-N-days** (default 14), forward-looking only; past events do not qualify.
- Ex-dividend is inherently pre-date (you buy before the ex-date to capture the dividend).
- Earnings is made **symmetric** with that: match only upcoming reports — you are positioning ahead of the catalyst.
- Post-earnings drift, if ever wanted, is a **separate future category**, not a tweak to Category 2.

## Consequences
- Consistent "position ahead of a catalyst" semantics across all three screens.
- No reaction-based (post-event) signal in the MVP.

## Alternatives considered
- **Either-side earnings window** — rejected: conflates front-running with drift, which are two distinct strategies that should not share one screen and one threshold.
