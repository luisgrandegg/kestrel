/**
 * Shared types and DTOs (backlog item 003).
 *
 * The explicitly-typed contracts exchanged across the pipeline seams
 * (CONSTITUTION.md §5). Everything here is provider-agnostic: no provider
 * name, endpoint, or field name may appear (CONSTITUTION.md §2.3).
 */

/** Calendar date in ISO 8601 format, e.g. "2026-07-12". */
export type IsoDate = string;

/** The data capabilities a provider can advertise (MVP.md §3). */
export type Capability =
  | "closes"
  | "analystTargets"
  | "earningsCalendar"
  | "dividendCalendar";

/** All capabilities, for registry iteration. */
export const CAPABILITIES: readonly Capability[] = [
  "closes",
  "analystTargets",
  "earningsCalendar",
  "dividendCalendar",
];

/** Instrument ingestion lifecycle (MVP.md §7). */
export type InstrumentState = "pending" | "backfilling" | "ready" | "error";

export const INSTRUMENT_STATES: readonly InstrumentState[] = [
  "pending",
  "backfilling",
  "ready",
  "error",
];

/** A watchlist instrument and its ingestion bookkeeping (MVP.md §4). */
export interface Instrument {
  ticker: string;
  /** Native trading currency; values render unconverted (MVP.md §8). */
  currency: string;
  state: InstrumentState;
  addedAt: IsoDate;
  lastPriceSync: IsoDate | null;
  lastMetadataSync: IsoDate | null;
}

/** One daily closing price observation. */
export interface DailyClose {
  ticker: string;
  /** Trading date the close belongs to. */
  date: IsoDate;
  /**
   * Closing price in the instrument's native currency. Always a positive,
   * finite number: adapters must reject zero/negative/non-finite closes at
   * the provider boundary, before storage (CLAUDE.md guardrail 6) — storage
   * is append-only, so a bad close, once persisted, can never be removed
   * and would poison every metric window containing it.
   */
  close: number;
}

/**
 * Analyst-target snapshot as observed on `asOf`.
 * Snapshots are append-only history, never overwritten (CONSTITUTION.md §3.1).
 */
export interface AnalystSnapshot {
  ticker: string;
  asOf: IsoDate;
  medianTarget: number;
  numAnalysts: number;
}

/** Next-earnings snapshot as observed on `asOf`. */
export interface EarningsSnapshot {
  ticker: string;
  asOf: IsoDate;
  /** `null` when no upcoming earnings date is scheduled. */
  nextEarningsDate: IsoDate | null;
}

/** Next-ex-dividend snapshot as observed on `asOf`. */
export interface DividendSnapshot {
  ticker: string;
  asOf: IsoDate;
  /** `null` when no upcoming ex-dividend date is scheduled. */
  nextExDivDate: IsoDate | null;
}
