import { isoDateToEpochDays } from "../types/guards.js";
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
 * Malformed or impossible dates fail loud in the shared parser.
 */
export function daysToEvent(eventDate: IsoDate, asOf: IsoDate): number {
  return (
    isoDateToEpochDays("eventDate", eventDate) -
    isoDateToEpochDays("asOf", asOf)
  );
}
