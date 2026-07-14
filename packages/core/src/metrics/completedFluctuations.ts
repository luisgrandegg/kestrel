import { assertPositiveFinite } from "../types/guards.js";

/**
 * Completed-fluctuations metric (backlog item 006) — MVP.md §5.2.
 *
 * Percentage-ZigZag / directional-change over closing prices with a single
 * reversal threshold θ. A directional leg counts only once the next ≥θ
 * reversal confirms it ("confirm-on-reversal"): the trailing, still-unfolding
 * leg is never counted, even if it has already moved past θ. Consequently a
 * single monotonic run with no reversal counts as 0.
 *
 * Pure function: no storage, no network, no clock (CONSTITUTION.md §3.2).
 * Callers slice `closes` to the configured lookback window and pass θ from
 * config (`fluctuation.swingPct`) — nothing here is hardcoded.
 *
 * @param closes chronological closing prices within the lookback window
 * @param swingPct reversal threshold θ as a ratio (e.g. 0.10 for 10%)
 */
export function countCompletedFluctuations(
  closes: readonly number[],
  swingPct: number,
): number {
  if (!Number.isFinite(swingPct) || swingPct <= 0 || swingPct >= 1) {
    // θ ≥ 1 would make confirmation mathematically impossible (a ≤ −θ
    // reversal needs price ≤ (1−θ)·extreme ≤ 0) and silently zero the
    // metric — reject it loudly instead (CONSTITUTION.md §6).
    throw new RangeError(
      `swingPct (θ) must be a ratio in (0, 1) — e.g. 0.10 for 10% — got: ${swingPct}`,
    );
  }
  for (const close of closes) {
    assertPositiveFinite("close", close);
  }

  const first = closes[0];
  if (closes.length < 2 || first === undefined) {
    return 0;
  }

  let count = 0;
  // 0 = direction undetermined, +1 = up-leg pending, -1 = down-leg pending.
  let direction: 0 | 1 | -1 = 0;
  // Running extreme of the current (pending) leg.
  let extreme: number = first;

  for (const price of closes.slice(1)) {
    if (direction === 0) {
      const change = (price - extreme) / extreme;
      if (change >= swingPct) {
        direction = 1;
        extreme = price;
      } else if (change <= -swingPct) {
        direction = -1;
        extreme = price;
      }
    } else if (direction === 1) {
      if (price > extreme) {
        extreme = price;
      } else if ((price - extreme) / extreme <= -swingPct) {
        count += 1; // up-leg confirmed by a ≥θ reversal down
        direction = -1;
        extreme = price;
      }
    } else {
      if (price < extreme) {
        extreme = price;
      } else if ((price - extreme) / extreme >= swingPct) {
        count += 1; // down-leg confirmed by a ≥θ reversal up
        direction = 1;
        extreme = price;
      }
    }
  }

  // The trailing pending leg is intentionally excluded.
  return count;
}
