import type { IsoDate } from "@kestrel/core/types";
import { isoDateToEpochDays } from "@kestrel/core/types/guards";

/**
 * Pure ISO-date arithmetic (UTC). Deterministic — no wall-clock reads
 * (guardrail 2): the run date always arrives as an injected parameter.
 * Uses the shared strict parser: impossible dates (Feb 30) fail loud
 * instead of silently rolling over into the next month.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) {
    throw new RangeError(`Invalid date arithmetic: addDays(${date}, ${days})`);
  }
  const epochDays = isoDateToEpochDays("date", date);
  return new Date((epochDays + days) * 86_400_000).toISOString().slice(0, 10);
}
