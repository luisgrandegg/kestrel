import type { IsoDate } from "../types/index.js";

/**
 * UTC calendar date of an instant — the daily run's dedupe key (MVP.md §7:
 * "dedupe by date so weekends/holidays add nothing"). Pure conversion so
 * the sanctioned wall-clock read stays confined to the CLI entrypoint;
 * everything below it takes an injected IsoDate (guardrail 2).
 */
export function utcIsoDate(instant: Date): IsoDate {
  return instant.toISOString().slice(0, 10);
}
