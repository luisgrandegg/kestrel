import type { InstrumentState } from "@kestrel/core/types";
import { assertIntegerAtLeast } from "@kestrel/core/types/guards";

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
  assertIntegerAtLeast("storedCloseCount", storedCloseCount, 0);
  assertIntegerAtLeast("lookbackTradingDays", lookbackTradingDays, 2);
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
  assertIntegerAtLeast("consecutiveFailures", consecutiveFailures, 1);
  assertIntegerAtLeast("maxConsecutiveFailures", maxConsecutiveFailures, 1);
  return consecutiveFailures >= maxConsecutiveFailures ? "error" : state;
}
