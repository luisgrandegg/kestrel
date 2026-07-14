/**
 * Shared fail-loud numeric guards (CONSTITUTION.md §5) — usable from any
 * layer. This module (like everything in types/) imports nothing: the
 * boundary lint pins types/ as a pure leaf so pure layers can never reach
 * I/O transitively through it.
 */

export function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${name} must be a positive finite number, got: ${value}`,
    );
  }
}

export function assertIntegerAtLeast(
  name: string,
  value: number,
  min: number,
): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer >= ${min}, got: ${value}`);
  }
}

export function assertNonNegativeInteger(name: string, value: number): void {
  assertIntegerAtLeast(name, value, 0);
}

/**
 * Dates order lexicographically everywhere (SQL bounds and cursors): a
 * non-zero-padded date silently sorts wrong — on the write side it would
 * persist forever, on the read side it defeats the as-of bound and reads
 * the future (guardrail 2). Both sides must fail loud instead.
 *
 * Also rejects well-formed but impossible dates: V8's ISO parsing rolls
 * out-of-range days over ("2026-02-30" becomes March 2), which would
 * silently shift event windows and date arithmetic — an append-only store
 * must never accept an observation that shifts on read.
 */
export function assertIsoDate(name: string, value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${name} must be YYYY-MM-DD, got: "${value}"`);
  }
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${name} is not a real calendar date: "${value}"`);
  }
}

/**
 * Days since the UTC epoch for a validated ISO date — the one shared
 * parser for calendar arithmetic (metrics' daysToEvent, ingestion's
 * addDays), so date strictness can never diverge between layers. Parses
 * the full ISO form with an explicit UTC offset: no two-digit-year rule,
 * no local-timezone drift, and division by a UTC day is always exact.
 */
export function isoDateToEpochDays(name: string, date: string): number {
  assertIsoDate(name, date);
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}
