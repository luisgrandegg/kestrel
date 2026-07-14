import type {
  AnalystSnapshot,
  DailyClose,
  DividendSnapshot,
  EarningsSnapshot,
  Instrument,
  InstrumentState,
  IsoDate,
} from "../types/index.js";

/**
 * Storage seam contract (MVP.md §11; CONSTITUTION.md §3.1–3.2).
 *
 * Consumers type against this interface, never a concrete driver; only
 * the composition root (src/app/) constructs one (lint-enforced by the
 * port-not-driver rule). The contract every implementation must honor:
 *
 * - **Append-only observation writes**: prices and metadata snapshots are
 *   insert-or-ignore — writing the same (ticker, date) / (ticker, as_of)
 *   twice is a no-op, and no historical observation is ever updated or
 *   deleted (CONSTITUTION.md §3.1).
 * - **As-of-bounded reads**: "latest" is always a max(as_of)/max(date)
 *   query, optionally bounded by an explicit as-of date — the no-lookahead
 *   read (CONSTITUTION.md §3.2) — never an overwrite.
 *
 * All methods are async so implementations may be backed by out-of-process
 * stores. Implementations: SQLite (`Repository`, ./repository.ts — tests
 * and local runs); Supabase Postgres (planned per ADR-0011).
 */
export interface StorageRepository {
  close(): Promise<void>;

  // ---- instruments (mutable bookkeeping, not observations) ----

  /** Register a watchlist ticker as `pending`. Re-adding is a no-op. */
  addInstrument(ticker: string, addedAt: IsoDate): Promise<void>;

  getInstrument(ticker: string): Promise<Instrument | undefined>;

  listInstruments(state?: InstrumentState): Promise<Instrument[]>;

  setInstrumentState(ticker: string, state: InstrumentState): Promise<void>;

  setInstrumentCurrency(ticker: string, currency: string): Promise<void>;

  recordPriceSync(ticker: string, asOf: IsoDate): Promise<void>;

  recordMetadataSync(ticker: string, asOf: IsoDate): Promise<void>;

  /**
   * Record one more consecutive adapter failure; returns the new count for
   * the caller to feed into the lifecycle threshold rule.
   */
  incrementFailures(ticker: string): Promise<number>;

  /** A successful fetch clears the consecutive-failure streak. */
  resetFailures(ticker: string): Promise<void>;

  // ---- prices (append-only observations) ----

  /**
   * Insert-or-ignore a batch of closes atomically.
   *
   * Validates the DailyClose contract (positive AND finite) here as the last
   * line before persistence: an append-only bad row could never be removed.
   */
  insertCloses(closes: readonly DailyClose[]): Promise<void>;

  /**
   * Chronological closes, optionally bounded (inclusive ISO dates).
   *
   * Note: lookbacks are defined in trading days (= stored rows) — use
   * {@link lastNCloses}, never calendar-date arithmetic, which undercounts
   * across holidays.
   */
  getCloses(
    ticker: string,
    from?: IsoDate,
    to?: IsoDate,
  ): Promise<DailyClose[]>;

  /**
   * The most recent `n` stored closes on or before `asOf` (defaults to all
   * history), in chronological order — the trading-days lookback read.
   */
  lastNCloses(ticker: string, n: number, asOf?: IsoDate): Promise<DailyClose[]>;

  /** Most recent stored close on or before `asOf` = max(date), no lookahead. */
  latestClose(ticker: string, asOf?: IsoDate): Promise<DailyClose | undefined>;

  // ---- metadata snapshots (append-only observations) ----
  // Each "latest" read takes an optional as-of bound: max(as_of) <= asOf.
  // That is both the reproducibility read (CONSTITUTION.md §3.1-3.2, "what
  // did this look like on date X") and the proof that prior rows stay
  // readable forever.

  /**
   * Snapshot writes validate their contract here, mirroring insertCloses:
   * a malformed observation persisted append-only could never be removed,
   * and would otherwise fail far downstream (e.g. a medianTarget of 0
   * blowing up the implied-upside metric on every future evaluation).
   */
  insertAnalystSnapshot(snapshot: AnalystSnapshot): Promise<void>;

  latestAnalystSnapshot(
    ticker: string,
    asOf?: IsoDate,
  ): Promise<AnalystSnapshot | undefined>;

  insertEarningsSnapshot(snapshot: EarningsSnapshot): Promise<void>;

  latestEarningsSnapshot(
    ticker: string,
    asOf?: IsoDate,
  ): Promise<EarningsSnapshot | undefined>;

  insertDividendSnapshot(snapshot: DividendSnapshot): Promise<void>;

  latestDividendSnapshot(
    ticker: string,
    asOf?: IsoDate,
  ): Promise<DividendSnapshot | undefined>;
}
