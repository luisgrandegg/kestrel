import { DatabaseSync } from "node:sqlite";
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
  Instrument,
  InstrumentState,
  IsoDate,
} from "../types/index.js";
import type { StorageRepository } from "./port.js";
import { SCHEMA } from "./schema.js";

/**
 * SQLite implementation of the {@link StorageRepository} port (backlog item
 * 008) — the only code that touches SQLite (MVP.md §11; enforced by the
 * dependency-boundary lint). The seam contract (append-only observation
 * writes, as-of-bounded reads) is documented on the port in ./port.ts.
 *
 * Built on the built-in `node:sqlite` — a deliberate choice of an
 * experimental Node API (unflagged since 22.13, which `engines` pins): zero
 * native dependencies, and the storage seam means swapping drivers
 * (e.g. better-sqlite3) would touch only this module. node:sqlite is
 * synchronous, so the async port methods simply resolve immediately.
 *
 * Observation writes use ON CONFLICT DO NOTHING: writing the same
 * (ticker, date) price or (ticker, as_of) snapshot twice is a no-op, and
 * nothing here can UPDATE or DELETE a historical observation
 * (CONSTITUTION.md §3.1). "Latest" is always a max(as_of)/max(date) query —
 * optionally bounded by an explicit as-of date, the no-lookahead read
 * (CONSTITUTION.md §3.2) — never an overwrite.
 */

const INSTRUMENT_SELECT = `SELECT ticker, currency, state, added_at AS addedAt,
       last_price_sync AS lastPriceSync,
       last_metadata_sync AS lastMetadataSync,
       consecutive_failures AS consecutiveFailures
  FROM instruments`;

export class Repository implements StorageRepository {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    // Infra timeout so concurrent writers queue instead of failing with an
    // instant SQLITE_BUSY — not a §9 judgement knob.
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // ---- instruments (mutable bookkeeping, not observations) ----

  async addInstrument(ticker: string, addedAt: IsoDate): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO instruments (ticker, state, added_at) VALUES (?, 'pending', ?) ON CONFLICT(ticker) DO NOTHING",
      )
      .run(ticker, addedAt);
  }

  async getInstrument(ticker: string): Promise<Instrument | undefined> {
    return this.db
      .prepare(`${INSTRUMENT_SELECT} WHERE ticker = ?`)
      .get(ticker) as unknown as Instrument | undefined;
  }

  async listInstruments(state?: InstrumentState): Promise<Instrument[]> {
    return this.db
      .prepare(
        `${INSTRUMENT_SELECT} WHERE (:state IS NULL OR state = :state) ORDER BY ticker`,
      )
      .all({ state: state ?? null }) as unknown as Instrument[];
  }

  async setInstrumentState(
    ticker: string,
    state: InstrumentState,
  ): Promise<void> {
    this.updateInstrument(
      "UPDATE instruments SET state = ? WHERE ticker = ?",
      state,
      ticker,
    );
  }

  async setInstrumentCurrency(ticker: string, currency: string): Promise<void> {
    this.updateInstrument(
      "UPDATE instruments SET currency = ? WHERE ticker = ?",
      currency,
      ticker,
    );
  }

  async recordPriceSync(ticker: string, asOf: IsoDate): Promise<void> {
    this.updateInstrument(
      "UPDATE instruments SET last_price_sync = ? WHERE ticker = ?",
      asOf,
      ticker,
    );
  }

  async recordMetadataSync(ticker: string, asOf: IsoDate): Promise<void> {
    this.updateInstrument(
      "UPDATE instruments SET last_metadata_sync = ? WHERE ticker = ?",
      asOf,
      ticker,
    );
  }

  async incrementFailures(ticker: string): Promise<number> {
    const result = this.db
      .prepare(
        "UPDATE instruments SET consecutive_failures = consecutive_failures + 1 WHERE ticker = ?",
      )
      .run(ticker);
    if (Number(result.changes) === 0) {
      throw new Error(`Unknown instrument: ${ticker}`);
    }
    const row = this.db
      .prepare(
        "SELECT consecutive_failures AS n FROM instruments WHERE ticker = ?",
      )
      .get(ticker) as { n: number };
    return row.n;
  }

  async resetFailures(ticker: string): Promise<void> {
    this.mustUpdate(
      this.db
        .prepare(
          "UPDATE instruments SET consecutive_failures = 0 WHERE ticker = ?",
        )
        .run(ticker),
      ticker,
    );
  }

  private mustUpdate(
    result: { changes: number | bigint },
    ticker: string,
  ): void {
    if (Number(result.changes) === 0) {
      throw new Error(`Unknown instrument: ${ticker}`);
    }
  }

  /** Run a single-column instrument UPDATE, failing loudly on unknown tickers. */
  private updateInstrument(sql: string, value: string, ticker: string): void {
    this.mustUpdate(this.db.prepare(sql).run(value, ticker), ticker);
  }

  /**
   * Validate an optional date bound before it reaches a lexicographic SQL
   * comparison: a malformed bound (e.g. "2026-7-1") compares greater than
   * every zero-padded date and would silently read past the intended as-of
   * date — a no-lookahead violation — instead of erroring.
   */
  private dateBound(name: string, bound?: IsoDate): string | null {
    if (bound === undefined) {
      return null;
    }
    assertIsoDate(name, bound);
    return bound;
  }

  // ---- prices (append-only observations) ----

  /**
   * Validates here (not in SQL) because SQL's CHECK cannot express
   * finiteness. Uses a savepoint rather than BEGIN so callers may compose
   * this inside their own transaction.
   */
  async insertCloses(closes: readonly DailyClose[]): Promise<void> {
    for (const { ticker, date, close } of closes) {
      assertPositiveFinite(`close for ${ticker} @ ${date}`, close);
      assertIsoDate(`close date for ${ticker}`, date);
    }
    const stmt = this.db.prepare(
      "INSERT INTO prices (ticker, date, close) VALUES (?, ?, ?) ON CONFLICT(ticker, date) DO NOTHING",
    );
    this.db.exec("SAVEPOINT insert_closes");
    try {
      for (const { ticker, date, close } of closes) {
        stmt.run(ticker, date, close);
      }
      this.db.exec("RELEASE insert_closes");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK TO insert_closes");
        this.db.exec("RELEASE insert_closes");
      } catch {
        // The transaction may already be gone (SQLite auto-rollback on e.g.
        // SQLITE_FULL) — the original error below is what matters.
      }
      throw error;
    }
  }

  async getCloses(
    ticker: string,
    from?: IsoDate,
    to?: IsoDate,
  ): Promise<DailyClose[]> {
    return this.db
      .prepare(
        `SELECT ticker, date, close FROM prices
         WHERE ticker = :ticker
           AND (:from IS NULL OR date >= :from)
           AND (:to IS NULL OR date <= :to)
         ORDER BY date`,
      )
      .all({
        ticker,
        from: this.dateBound("from", from),
        to: this.dateBound("to", to),
      }) as unknown as DailyClose[];
  }

  async lastNCloses(
    ticker: string,
    n: number,
    asOf?: IsoDate,
  ): Promise<DailyClose[]> {
    assertNonNegativeInteger("n", n);
    const rows = this.db
      .prepare(
        `SELECT ticker, date, close FROM prices
         WHERE ticker = :ticker AND (:asOf IS NULL OR date <= :asOf)
         ORDER BY date DESC LIMIT :n`,
      )
      .all({
        ticker,
        asOf: this.dateBound("asOf", asOf),
        n,
      }) as unknown as DailyClose[];
    return rows.reverse();
  }

  async latestClose(
    ticker: string,
    asOf?: IsoDate,
  ): Promise<DailyClose | undefined> {
    return this.db
      .prepare(
        `SELECT ticker, date, close FROM prices
         WHERE ticker = :ticker AND (:asOf IS NULL OR date <= :asOf)
         ORDER BY date DESC LIMIT 1`,
      )
      .get({ ticker, asOf: this.dateBound("asOf", asOf) }) as unknown as
      | DailyClose
      | undefined;
  }

  // ---- metadata snapshots (append-only observations) ----

  async insertAnalystSnapshot(snapshot: AnalystSnapshot): Promise<void> {
    assertIsoDate(
      `analyst snapshot asOf for ${snapshot.ticker}`,
      snapshot.asOf,
    );
    assertPositiveFinite(
      `medianTarget for ${snapshot.ticker}`,
      snapshot.medianTarget,
    );
    assertNonNegativeInteger(
      `numAnalysts for ${snapshot.ticker}`,
      snapshot.numAnalysts,
    );
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

  async latestAnalystSnapshot(
    ticker: string,
    asOf?: IsoDate,
  ): Promise<AnalystSnapshot | undefined> {
    return this.db
      .prepare(
        `SELECT ticker, as_of AS asOf, median_target AS medianTarget,
                num_analysts AS numAnalysts
         FROM analyst_snapshots
         WHERE ticker = :ticker AND (:asOf IS NULL OR as_of <= :asOf)
         ORDER BY as_of DESC LIMIT 1`,
      )
      .get({ ticker, asOf: this.dateBound("asOf", asOf) }) as unknown as
      | AnalystSnapshot
      | undefined;
  }

  async insertEarningsSnapshot(snapshot: EarningsSnapshot): Promise<void> {
    assertIsoDate(
      `earnings snapshot asOf for ${snapshot.ticker}`,
      snapshot.asOf,
    );
    if (snapshot.nextEarningsDate !== null) {
      assertIsoDate(
        `nextEarningsDate for ${snapshot.ticker}`,
        snapshot.nextEarningsDate,
      );
    }
    this.db
      .prepare(
        "INSERT INTO earnings_snapshots (ticker, as_of, next_earnings_date) VALUES (?, ?, ?) ON CONFLICT(ticker, as_of) DO NOTHING",
      )
      .run(snapshot.ticker, snapshot.asOf, snapshot.nextEarningsDate);
  }

  async latestEarningsSnapshot(
    ticker: string,
    asOf?: IsoDate,
  ): Promise<EarningsSnapshot | undefined> {
    return this.db
      .prepare(
        `SELECT ticker, as_of AS asOf, next_earnings_date AS nextEarningsDate
         FROM earnings_snapshots
         WHERE ticker = :ticker AND (:asOf IS NULL OR as_of <= :asOf)
         ORDER BY as_of DESC LIMIT 1`,
      )
      .get({ ticker, asOf: this.dateBound("asOf", asOf) }) as unknown as
      | EarningsSnapshot
      | undefined;
  }

  async insertDividendSnapshot(snapshot: DividendSnapshot): Promise<void> {
    assertIsoDate(
      `dividend snapshot asOf for ${snapshot.ticker}`,
      snapshot.asOf,
    );
    if (snapshot.nextExDivDate !== null) {
      assertIsoDate(
        `nextExDivDate for ${snapshot.ticker}`,
        snapshot.nextExDivDate,
      );
    }
    this.db
      .prepare(
        "INSERT INTO dividend_snapshots (ticker, as_of, next_ex_div_date) VALUES (?, ?, ?) ON CONFLICT(ticker, as_of) DO NOTHING",
      )
      .run(snapshot.ticker, snapshot.asOf, snapshot.nextExDivDate);
  }

  async latestDividendSnapshot(
    ticker: string,
    asOf?: IsoDate,
  ): Promise<DividendSnapshot | undefined> {
    return this.db
      .prepare(
        `SELECT ticker, as_of AS asOf, next_ex_div_date AS nextExDivDate
         FROM dividend_snapshots
         WHERE ticker = :ticker AND (:asOf IS NULL OR as_of <= :asOf)
         ORDER BY as_of DESC LIMIT 1`,
      )
      .get({ ticker, asOf: this.dateBound("asOf", asOf) }) as unknown as
      | DividendSnapshot
      | undefined;
  }
}
