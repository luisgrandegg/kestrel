# ADR-0003: Category-1 volatility measured as completed-swing frequency

**Status:** Accepted — 2026-07-12

## Context
Category 1 pairs long-term analyst upside with "volatility." The intent, clarified during spec, is *sharp changes of value that happen frequently* — e.g. a stock that repeatedly swings ±10% over three months — on the thesis that repeated swings hand you entries while the upside gives long-term leverage. The metric therefore needs to answer "how often does it swing hard," not "how much does it typically move."

## Decision
Measure Category-1 volatility as the **count of completed directional swings ≥ a threshold** over a trailing window (defaults: ≥10% moves, ≥4 occurrences, 63 trading days). This is a **frequency/event-count** metric, not a dispersion metric. The precise detection algorithm is defined in ADR-0004.

## Consequences
- Directly matches the "repeated sharp moves" intent, with configurable knobs (swing size, occurrence count, lookback).
- Dispersion intuitions don't apply: a steadily-drifting high-range name will *not* qualify, and a name that's calm then spikes several times *will* — by design.

## Alternatives considered
- **ATR% (Average True Range ÷ price)** — rejected: measures average daily range (magnitude), not the count of big moves. A steady drifter scores high; a name that's flat between occasional spikes scores low — backwards for this thesis.
- **Beta** — rejected: captures only the market-correlated portion of movement. The idiosyncratic single-name dislocations we want (e.g. an earnings gap while the market is flat) barely register, and it adds a market-index data dependency.
- **Realized volatility (stdev of returns)** — rejected: averages movement into one number, understating a name that is quiet most days and spikes occasionally.
