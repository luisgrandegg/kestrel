import type { KestrelConfig } from "../config/index.js";
import { countCompletedFluctuations } from "../metrics/completedFluctuations.js";
import { type BaseMatch, evaluateBase } from "./base.js";
import type { Screen } from "./screen.js";

/**
 * Category 1 — volatile + undervalued (MVP.md §6 row 1, backlog item 015):
 *
 *   BASE AND completedFluctuations(θ, lookback) >= minOccurrences
 *
 * The count runs over stored closes only, as-of date explicit. The screen
 * enforces its own window — the trailing `fluctuation.lookbackTradingDays`
 * rows of whatever closes it is handed — rather than trusting the caller
 * to have sized the snapshot correctly. A younger instrument with fewer
 * stored closes is counted over what exists: those rows ARE the trailing
 * window's full content, so the count is the true observed count (never a
 * fabricated one). All thresholds are bound from config at construction
 * (guardrail 5).
 */

/** Category 1 row numbers (MVP.md §8): the base numbers + the swing count. */
export interface Category1Match extends BaseMatch {
  completedFluctuations: number;
}

export function makeCategory1Screen(
  config: KestrelConfig,
): Screen<Category1Match> {
  const { minAnalysts } = config;
  const { upsideThreshold } = config.screens.category1;
  const { swingPct, minOccurrences, lookbackTradingDays } = config.fluctuation;
  return {
    id: "category1",
    requiredCapabilities: ["closes", "analystTargets"],
    evaluate(snapshot) {
      const base = evaluateBase(snapshot, minAnalysts, upsideThreshold);
      if (base === null) {
        return null;
      }
      const completed = countCompletedFluctuations(
        snapshot.closes
          .slice(-lookbackTradingDays)
          .map((dailyClose) => dailyClose.close),
        swingPct,
      );
      if (completed < minOccurrences) {
        return null;
      }
      return { ...base, completedFluctuations: completed };
    },
  };
}
