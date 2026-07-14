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

/**
 * Result of resolving a screen's required capabilities against the active
 * providers (CONSTITUTION.md §2.1). Lives here — not in providers/ — because
 * its consumers (the screening harness and the UI's disabled-screen state)
 * sit on the far side of the provider seam and may not import providers/.
 */
export type ScreenResolution =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly missing: readonly Capability[] };

/**
 * One screen's evaluation result: its registry resolution and (when
 * enabled) the matches with their supporting numbers. Lives here so the
 * presentation can type against it without importing the composition root
 * (the boundary lint pins apps/web/src/app/ as the top of the graph).
 */
export interface ScreenEvaluation<Match> {
  screenId: string;
  resolution: ScreenResolution;
  /** Matches with their supporting numbers; empty when disabled. */
  matches: Match[];
}

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
  /**
   * Native trading currency; values render unconverted (MVP.md §8).
   * `null` until the first provider metadata fetch reports it.
   */
  currency: string | null;
  state: InstrumentState;
  addedAt: IsoDate;
  /**
   * Date of the last price-sync ATTEMPT — not a coverage watermark: it is
   * stamped even when the fetch was partial or skipped. Never use it as the
   * incremental cursor (that is always the latest stored close); its
   * legitimate use is once-per-day run dedupe.
   */
  lastPriceSync: IsoDate | null;
  lastMetadataSync: IsoDate | null;
  /** Consecutive adapter failures; reset on success (MVP.md §7 error rule). */
  consecutiveFailures: number;
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
