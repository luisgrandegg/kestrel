import type { KestrelConfig } from "../config/index.js";
import { daysToEvent } from "../metrics/daysToEvent.js";
import type { IsoDate } from "../types/index.js";
import { type BaseMatch, evaluateBase } from "./base.js";
import type { Screen } from "./screen.js";

/**
 * Category 2 — pre-earnings + undervalued (MVP.md §6 row 2, backlog 016):
 *
 *   BASE AND 0 <= daysToEarnings <= earnings.windowDays
 *
 * Upcoming-only: this front-runs the report — a past earnings date never
 * qualifies (post-earnings drift is a separate future category, not a
 * tweak here). The earnings date comes from the latest stored snapshot on
 * or before the as-of date; an instrument with no snapshot, or none
 * announcing a date, is missing data — no match, never a fabricated event
 * (guardrail 4). Thresholds bound from config at construction.
 */

/** Category 2 row numbers (MVP.md §8): base numbers + event proximity. */
export interface Category2Match extends BaseMatch {
  daysToEarnings: number;
  nextEarningsDate: IsoDate;
}

export function makeCategory2Screen(
  config: KestrelConfig,
): Screen<Category2Match> {
  const { minAnalysts } = config;
  const { upsideThreshold } = config.screens.category2;
  const { windowDays } = config.earnings;
  return {
    id: "category2",
    requiredCapabilities: ["analystTargets", "earningsCalendar", "closes"],
    evaluate(snapshot) {
      const base = evaluateBase(snapshot, minAnalysts, upsideThreshold);
      if (base === null) {
        return null;
      }
      const nextEarningsDate = snapshot.earnings?.nextEarningsDate ?? null;
      if (nextEarningsDate === null) {
        return null;
      }
      const days = daysToEvent(nextEarningsDate, snapshot.asOf);
      if (days < 0 || days > windowDays) {
        return null;
      }
      return { ...base, daysToEarnings: days, nextEarningsDate };
    },
  };
}
