import type { IsoDate } from "../types/index.js";

/**
 * Pure ISO-date arithmetic (UTC). Deterministic — no wall-clock reads
 * (guardrail 2): the run date always arrives as an injected parameter.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms) || !Number.isInteger(days)) {
    throw new RangeError(`Invalid date arithmetic: addDays(${date}, ${days})`);
  }
  const shifted = new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
  return shifted;
}
