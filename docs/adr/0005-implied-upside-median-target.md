# ADR-0005: Implied upside via median analyst target with minimum-analyst gate

**Status:** Accepted — 2026-07-12

## Context
All three screens share a base predicate: analyst-implied upside ≥ a threshold. Two risks must be handled: a single extreme analyst target skewing the signal, and a "high upside" reading resting on too few analysts to be meaningful.

## Decision
`impliedUpside = (medianTarget − latestClose) / latestClose`.
- Use the **median** target, not the mean.
- Apply a **minimum-analyst quality gate**: instruments with fewer than `minAnalysts` (default 5) do not qualify in any screen.
- The upside threshold is **configurable per screen** (default 20%; the Category-1 example used 40%).

## Consequences
- Robust to one outlier analyst; thin-coverage names are excluded before they can trigger a screen.
- Requires a data source exposing **both** a median target and an analyst count — a real constraint on which providers qualify (see ADR-0008).

## Alternatives considered
- **Mean target** — rejected: sensitive to a single extreme estimate.
- **No analyst-count gate** — rejected: a +20% implied upside from 2 analysts is noise, not signal.
