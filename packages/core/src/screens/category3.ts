import type { KestrelConfig } from "../config/index.js";
import { daysToEvent } from "../metrics/daysToEvent.js";
import type { IsoDate } from "../types/index.js";
import { type BaseMatch, evaluateBase } from "./base.js";
import type { Screen } from "./screen.js";

/**
 * Category 3 — pre-ex-dividend + undervalued (MVP.md §6 row 3, backlog 017):
 *
 *   BASE AND 0 <= daysToExDiv <= exDividend.windowDays
 *
 * Same upcoming-only calendar-day semantics as category 2, over the latest
 * stored dividend snapshot: a past ex-dividend date never qualifies, and an
 * instrument with no snapshot — or none announcing a date — is missing
 * data, never a fabricated event (guardrail 4). Thresholds bound from
 * config at construction.
 */

/** Category 3 row numbers (MVP.md §8): base numbers + event proximity. */
export interface Category3Match extends BaseMatch {
  daysToExDiv: number;
  nextExDivDate: IsoDate;
}

export function makeCategory3Screen(
  config: KestrelConfig,
): Screen<Category3Match> {
  const { minAnalysts } = config;
  const { upsideThreshold } = config.screens.category3;
  const { windowDays } = config.exDividend;
  return {
    id: "category3",
    requiredCapabilities: ["analystTargets", "dividendCalendar", "closes"],
    evaluate(snapshot) {
      const base = evaluateBase(snapshot, minAnalysts, upsideThreshold);
      if (base === null) {
        return null;
      }
      const nextExDivDate = snapshot.dividend?.nextExDivDate ?? null;
      if (nextExDivDate === null) {
        return null;
      }
      const days = daysToEvent(nextExDivDate, snapshot.asOf);
      if (days < 0 || days > windowDays) {
        return null;
      }
      return { ...base, daysToExDiv: days, nextExDivDate };
    },
  };
}
