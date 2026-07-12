import { DatabaseSync } from "node:sqlite";
import type {
  AnalystSnapshot,
  DailyClose,
  DividendSnapshot,
  EarningsSnapshot,
  Instrument,
  InstrumentState,
  IsoDate,
} from "../types/index.js";
import { SCHEMA } from "./schema.js";

/**
 * Storage repository (backlog item 008) — the only code that touches SQLite
 * (MVP.md §11; enforced by the dependency-boundary lint).
 *
 * Observation writes use ON CONFLICT DO NOTHING: writing the same (ticker, date)
 * price or (ticker, as_of) snapshot twice is a no-op, and nothing here can
 * UPDATE or DELETE a historical observation (CONSTITUTION.md §3.1).
 * "Latest" is always a max(as_of)/max(date) query, never an overwrite.
 */
export class Repository {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---- instruments (mutable bookkeeping, not observations) ----

  /** Register a watchlist ticker as `pending`. Re-adding is a no-op. */
  addInstrument(ticker: string, addedAt: IsoDate): void {
    this.db
      .prepare(
        "INSERT INTO instruments (ticker, state, added_at) VALUES (?, 'pending', ?) ON CONFLICT(ticker) DO NOTHING",
      )
      .run(ticker, addedAt);
  }

  getInstrument(ticker: string): Instrument | undefined {
    const row = this.db
      .prepare(
        `SELECT ticker, currency, state, added_at AS addedAt,
                last_price_sync AS lastPriceSync,
                last_metadata_sync AS lastMetadataSync
         FROM instruments WHERE ticker = ?`,
      )
      .get(ticker);
    return row === undefined ? undefined : (row as unknown as Instrument);
  }

  listInstruments(state?: InstrumentState): Instrument[] {
    const rows =
      state === undefined
        ? this.db
            .prepare(
              `SELECT ticker, currency, state, added_at AS addedAt,
                      last_price_sync AS lastPriceSync,
                      last_metadata_sync AS lastMetadataSync
               FROM instruments ORDER BY ticker`,
            )
            .all()
        : this.db
            .prepare(
              `SELECT ticker, currency, state, added_at AS addedAt,
                      last_price_sync AS lastPriceSync,
                      last_metadata_sync AS lastMetadataSync
               FROM instruments WHERE state = ? ORDER BY ticker`,
            )
            .all(state);
    return rows as unknown as Instrument[];
  }

  setInstrumentState(ticker: string, state: InstrumentState): void {
    this.mustUpdateInstrument(
      this.db
        .prepare("UPDATE instruments SET state = ? WHERE ticker = ?")
        .run(state, ticker),
      ticker,
    );
  }

  setInstrumentCurrency(ticker: string, currency: string): void {
    this.mustUpdateInstrument(
      this.db
        .prepare("UPDATE instruments SET currency = ? WHERE ticker = ?")
        .run(currency, ticker),
      ticker,
    );
  }

  recordPriceSync(ticker: string, asOf: IsoDate): void {
    this.mustUpdateInstrument(
      this.db
        .prepare("UPDATE instruments SET last_price_sync = ? WHERE ticker = ?")
        .run(asOf, ticker),
      ticker,
    );
  }

  recordMetadataSync(ticker: string, asOf: IsoDate): void {
    this.mustUpdateInstrument(
      this.db
        .prepare(
          "UPDATE instruments SET last_metadata_sync = ? WHERE ticker = ?",
        )
        .run(asOf, ticker),
      ticker,
    );
  }

  private mustUpdateInstrument(
    result: { changes: number | bigint },
    ticker: string,
  ): void {
    if (Number(result.changes) === 0) {
      throw new Error(`Unknown instrument: ${ticker}`);
    }
  }

  // ---- prices (append-only observations) ----

  /** Insert-or-ignore a batch of closes atomically. */
  insertCloses(closes: readonly DailyClose[]): void {
    const stmt = this.db.prepare(
      "INSERT INTO prices (ticker, date, close) VALUES (?, ?, ?) ON CONFLICT(ticker, date) DO NOTHING",
    );
    this.db.exec("BEGIN");
    try {
      for (const { ticker, date, close } of closes) {
        stmt.run(ticker, date, close);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Chronological closes, optionally bounded (inclusive ISO dates). */
  getCloses(ticker: string, from?: IsoDate, to?: IsoDate): DailyClose[] {
    const rows = this.db
      .prepare(
        `SELECT ticker, date, close FROM prices
         WHERE ticker = ?
           AND (? IS NULL OR date >= ?)
           AND (? IS NULL OR date <= ?)
         ORDER BY date`,
      )
      .all(ticker, from ?? null, from ?? null, to ?? null, to ?? null);
    return rows as unknown as DailyClose[];
  }

  /** Most recent stored close = max(date), not an overwrite. */
  latestClose(ticker: string): DailyClose | undefined {
    const row = this.db
      .prepare(
        "SELECT ticker, date, close FROM prices WHERE ticker = ? ORDER BY date DESC LIMIT 1",
      )
      .get(ticker);
    return row === undefined ? undefined : (row as unknown as DailyClose);
  }

  // ---- metadata snapshots (append-only observations) ----

  insertAnalystSnapshot(snapshot: AnalystSnapshot): void {
    this.db
      .prepare(
        "INSERT INTO analyst_snapshots (ticker, as_of, median_target, num_analysts) VALUES (?, ?, ?, ?) ON CONFLICT(ticker, as_of) DO NOTHING",
      )
      .run(
        snapshot.ticker,
        snapshot.asOf,
        snapshot.medianTarget,
        snapshot.numAnalysts,
      );
  }

  latestAnalystSnapshot(ticker: string): AnalystSnapshot | undefined {
    const row = this.db
      .prepare(
        `SELECT ticker, as_of AS asOf, median_target AS medianTarget,
                num_analysts AS numAnalysts
         FROM analyst_snapshots WHERE ticker = ?
         ORDER BY as_of DESC LIMIT 1`,
      )
      .get(ticker);
    return row === undefined ? undefined : (row as unknown as AnalystSnapshot);
  }

  insertEarningsSnapshot(snapshot: EarningsSnapshot): void {
    this.db
      .prepare(
        "INSERT INTO earnings_snapshots (ticker, as_of, next_earnings_date) VALUES (?, ?, ?) ON CONFLICT(ticker, as_of) DO NOTHING",
      )
      .run(snapshot.ticker, snapshot.asOf, snapshot.nextEarningsDate);
  }

  latestEarningsSnapshot(ticker: string): EarningsSnapshot | undefined {
    const row = this.db
      .prepare(
        `SELECT ticker, as_of AS asOf, next_earnings_date AS nextEarningsDate
         FROM earnings_snapshots WHERE ticker = ?
         ORDER BY as_of DESC LIMIT 1`,
      )
      .get(ticker);
    return row === undefined ? undefined : (row as unknown as EarningsSnapshot);
  }

  insertDividendSnapshot(snapshot: DividendSnapshot): void {
    this.db
      .prepare(
        "INSERT INTO dividend_snapshots (ticker, as_of, next_ex_div_date) VALUES (?, ?, ?) ON CONFLICT(ticker, as_of) DO NOTHING",
      )
      .run(snapshot.ticker, snapshot.asOf, snapshot.nextExDivDate);
  }

  latestDividendSnapshot(ticker: string): DividendSnapshot | undefined {
    const row = this.db
      .prepare(
        `SELECT ticker, as_of AS asOf, next_ex_div_date AS nextExDivDate
         FROM dividend_snapshots WHERE ticker = ?
         ORDER BY as_of DESC LIMIT 1`,
      )
      .get(ticker);
    return row === undefined ? undefined : (row as unknown as DividendSnapshot);
  }
}
