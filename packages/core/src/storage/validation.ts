import {
  assertIsoDate,
  assertNonNegativeInteger,
  assertPositiveFinite,
} from "../types/guards.js";
import type {
  AnalystSnapshot,
  DailyClose,
  DividendSnapshot,
  EarningsSnapshot,
  IsoDate,
} from "../types/index.js";

/**
 * Write-edge and read-bound validation shared by every StorageRepository
 * implementation (SQLite and Postgres), so the two engines cannot drift in
 * what they accept. Validated here (not in SQL) because SQL's CHECK cannot
 * express finiteness or calendar validity — and storage is append-only, so
 * a malformed observation, once persisted, could never be removed and would
 * fail far downstream forever (see the port docs in ./port.ts).
 */

/** Validate every row of a closes batch before any row is persisted. */
export function validateCloses(closes: readonly DailyClose[]): void {
  for (const { ticker, date, close } of closes) {
    assertPositiveFinite(`close for ${ticker} @ ${date}`, close);
    assertIsoDate(`close date for ${ticker}`, date);
  }
}

export function validateAnalystSnapshot(snapshot: AnalystSnapshot): void {
  assertIsoDate(`analyst snapshot asOf for ${snapshot.ticker}`, snapshot.asOf);
  assertPositiveFinite(
    `medianTarget for ${snapshot.ticker}`,
    snapshot.medianTarget,
  );
  assertNonNegativeInteger(
    `numAnalysts for ${snapshot.ticker}`,
    snapshot.numAnalysts,
  );
}

export function validateEarningsSnapshot(snapshot: EarningsSnapshot): void {
  assertIsoDate(`earnings snapshot asOf for ${snapshot.ticker}`, snapshot.asOf);
  if (snapshot.nextEarningsDate !== null) {
    assertIsoDate(
      `nextEarningsDate for ${snapshot.ticker}`,
      snapshot.nextEarningsDate,
    );
  }
}

export function validateDividendSnapshot(snapshot: DividendSnapshot): void {
  assertIsoDate(`dividend snapshot asOf for ${snapshot.ticker}`, snapshot.asOf);
  if (snapshot.nextExDivDate !== null) {
    assertIsoDate(
      `nextExDivDate for ${snapshot.ticker}`,
      snapshot.nextExDivDate,
    );
  }
}

/**
 * Validate an optional date bound before it reaches a lexicographic SQL
 * comparison: a malformed bound (e.g. "2026-7-1") compares greater than
 * every zero-padded date and would silently read past the intended as-of
 * date — a no-lookahead violation — instead of erroring.
 */
export function dateBound(name: string, bound?: IsoDate): string | null {
  if (bound === undefined) {
    return null;
  }
  assertIsoDate(name, bound);
  return bound;
}
