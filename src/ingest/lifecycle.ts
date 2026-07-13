import type { InstrumentState } from "../types/index.js";

/**
 * Instrument lifecycle transitions (backlog item 011) — MVP.md §7:
 * pending → backfilling → ready, with error on repeated adapter failure.
 *
 * Pure, testable rules; persistence of state (and of failure counts) is the
 * ingestion runner's concern (items 012–013). A partial backfill is a valid
 * state, not an error. `error` is sticky — recovery is a manual decision,
 * not an automatic retry loop against a provider that keeps failing.
 */

/** Ingestion has started working on the instrument. */
export function startBackfill(state: InstrumentState): InstrumentState {
  return state === "pending" ? "backfilling" : state;
}

/**
 * Promote to `ready` once stored history covers the configured lookback
 * (in trading days = stored rows, never calendar arithmetic).
 */
export function promoteWhenCovered(
  state: InstrumentState,
  storedCloseCount: number,
  lookbackTradingDays: number,
): InstrumentState {
  if (!Number.isInteger(storedCloseCount) || storedCloseCount < 0) {
    throw new RangeError(
      `storedCloseCount must be a non-negative integer, got: ${storedCloseCount}`,
    );
  }
  if (!Number.isInteger(lookbackTradingDays) || lookbackTradingDays < 2) {
    throw new RangeError(
      `lookbackTradingDays must be an integer >= 2, got: ${lookbackTradingDays}`,
    );
  }
  if (
    (state === "pending" || state === "backfilling") &&
    storedCloseCount >= lookbackTradingDays
  ) {
    return "ready";
  }
  return state;
}

/**
 * Demote to `error` after repeated consecutive adapter failures. The
 * threshold comes from config (`ingestion.maxConsecutiveFailures`) — never
 * hardcoded (guardrail 5).
 */
export function recordFailure(
  state: InstrumentState,
  consecutiveFailures: number,
  maxConsecutiveFailures: number,
): InstrumentState {
  if (!Number.isInteger(consecutiveFailures) || consecutiveFailures < 1) {
    throw new RangeError(
      `consecutiveFailures must be a positive integer (call after a failure), got: ${consecutiveFailures}`,
    );
  }
  if (!Number.isInteger(maxConsecutiveFailures) || maxConsecutiveFailures < 1) {
    throw new RangeError(
      `maxConsecutiveFailures must be a positive integer, got: ${maxConsecutiveFailures}`,
    );
  }
  return consecutiveFailures >= maxConsecutiveFailures ? "error" : state;
}
