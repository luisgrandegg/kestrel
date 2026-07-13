import { assertIsoDate } from "../types/guards.js";
import type { IsoDate } from "../types/index.js";

/**
 * Event-proximity metric (backlog items 016/017) — MVP.md §5.3:
 *
 *   daysToEvent = eventDate − asOfDate   (calendar days)
 *
 * Pure function over two explicit dates: no clock read (guardrail 2) — the
 * as-of date is a parameter, never `Date.now()`. A past event yields a
 * negative count; the screens' `0 <= days <= windowDays` bound is what
 * enforces the upcoming-only semantics ("past events do not qualify").
 */
export function daysToEvent(eventDate: IsoDate, asOf: IsoDate): number {
  return utcEpochDays("eventDate", eventDate) - utcEpochDays("asOf", asOf);
}

/** Days since the UTC epoch, failing loud on malformed or impossible dates. */
function utcEpochDays(name: string, date: IsoDate): number {
  assertIsoDate(name, date);
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const ms = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(ms);
  // Date.UTC silently rolls impossible dates over (Feb 30 -> Mar 2); a
  // stored-but-impossible event date must error, not shift the window.
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new RangeError(`${name} is not a real calendar date: "${date}"`);
  }
  return ms / 86_400_000;
}
