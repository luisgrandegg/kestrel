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
  if (!Number.isFinite(swingPct) || swingPct <= 0) {
    throw new RangeError(
      `swingPct (θ) must be a positive finite ratio, got: ${swingPct}`,
    );
  }
  for (const close of closes) {
    if (!Number.isFinite(close) || close <= 0) {
      throw new RangeError(
        `closes must be positive finite prices, got: ${close}`,
      );
    }
  }

  if (closes.length < 2) {
    return 0;
  }

  let count = 0;
  // 0 = direction undetermined, +1 = up-leg pending, -1 = down-leg pending.
  let direction: 0 | 1 | -1 = 0;
  // Running extreme of the current (pending) leg.
  let extreme = closes[0] as number;

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
