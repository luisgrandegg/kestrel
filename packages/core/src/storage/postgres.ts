import { assertNonNegativeInteger } from "../types/guards.js";
import type {
  AnalystSnapshot,
  DailyClose,
  DividendSnapshot,
  EarningsSnapshot,
  Instrument,
  InstrumentState,
  IsoDate,
} from "../types/index.js";
import type { SqlExecutor } from "./executor.js";
import type { StorageRepository } from "./port.js";
import {
  dateBound,
  validateAnalystSnapshot,
  validateCloses,
  validateDividendSnapshot,
  validateEarningsSnapshot,
} from "./validation.js";

/**
 * Postgres implementation of the {@link StorageRepository} port — the
 * Supabase engine (ADR-0011). The seam contract (append-only observation
 * writes, as-of-bounded reads) is documented on the port in ./port.ts; the
 * schema is supabase/migrations/00001_init.sql, the Postgres twin of
 * ./schema.ts.
 *
 * Mirrors the SQLite `Repository` statement for statement so the shared
 * contract tests pass identically against both engines: the same shared
 * write-edge validation (./validation.ts), ON CONFLICT DO NOTHING
 * insert-or-ignore, max(as_of)/max(date) "latest" reads with the same
 * validated as-of bounds, and the same fail-loud `Unknown instrument`
 * updates.
 *
 * Talks to the database only through the driver-agnostic {@link SqlExecutor}
 * seam (./executor.ts), so this module — and @kestrel/core — has no driver
 * dependency: the contract tests adapt PGlite; the deployed composition
 * root (apps/web/src/app/_lib/db.ts) adapts `pg.Pool` over Supabase's
 * pooled connection string. Batch atomicity (insertCloses) is the only
 * transactional guarantee — it runs a top-level transaction on a pooled
 * connection, so callers must never wrap repository calls in an outer
 * transaction of their own (the SQLite engine's savepoint would nest;
 * this one would not — the port exposes no transaction concept for
 * exactly that reason). Column aliases are quoted
 * (`AS "asOf"`) because Postgres lowercases unquoted identifiers; optional
 * parameters carry explicit `::text` casts so null-elision predicates
 * (`$n IS NULL OR ...`) stay typeable by the planner.
 */

const INSTRUMENT_SELECT = `SELECT ticker, currency, state, added_at AS "addedAt",
       last_price_sync AS "lastPriceSync",
       last_metadata_sync AS "lastMetadataSync",
       consecutive_failures AS "consecutiveFailures"
  FROM instruments`;

export class PostgresRepository implements StorageRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async close(): Promise<void> {
    await this.sql.end();
  }

  // ---- instruments (mutable bookkeeping, not observations) ----

  async addInstrument(ticker: string, addedAt: IsoDate): Promise<void> {
    await this.sql.query(
      "INSERT INTO instruments (ticker, state, added_at) VALUES ($1, 'pending', $2) ON CONFLICT (ticker) DO NOTHING",
      [ticker, addedAt],
    );
  }

  async getInstrument(ticker: string): Promise<Instrument | undefined> {
    const { rows } = await this.sql.query(
      `${INSTRUMENT_SELECT} WHERE ticker = $1`,
      [ticker],
    );
    return rows[0] as Instrument | undefined;
  }

  async listInstruments(state?: InstrumentState): Promise<Instrument[]> {
    const { rows } = await this.sql.query(
      `${INSTRUMENT_SELECT} WHERE ($1::text IS NULL OR state = $1) ORDER BY ticker`,
      [state ?? null],
    );
    return rows as unknown as Instrument[];
  }

  async setInstrumentState(
    ticker: string,
    state: InstrumentState,
  ): Promise<void> {
    await this.updateInstrument(
      "UPDATE instruments SET state = $1 WHERE ticker = $2",
      state,
      ticker,
    );
  }

  async setInstrumentCurrency(ticker: string, currency: string): Promise<void> {
    await this.updateInstrument(
      "UPDATE instruments SET currency = $1 WHERE ticker = $2",
      currency,
      ticker,
    );
  }

  async recordPriceSync(ticker: string, asOf: IsoDate): Promise<void> {
    await this.updateInstrument(
      "UPDATE instruments SET last_price_sync = $1 WHERE ticker = $2",
      asOf,
      ticker,
    );
  }

  async recordMetadataSync(ticker: string, asOf: IsoDate): Promise<void> {
    await this.updateInstrument(
      "UPDATE instruments SET last_metadata_sync = $1 WHERE ticker = $2",
      asOf,
      ticker,
    );
  }

  async incrementFailures(ticker: string): Promise<number> {
    const { rows } = await this.sql.query(
      `UPDATE instruments SET consecutive_failures = consecutive_failures + 1
       WHERE ticker = $1 RETURNING consecutive_failures AS "n"`,
      [ticker],
    );
    const row = rows[0] as { n: number } | undefined;
    if (row === undefined) {
      throw new Error(`Unknown instrument: ${ticker}`);
    }
    return row.n;
  }

  async resetFailures(ticker: string): Promise<void> {
    this.mustUpdate(
      await this.sql.query(
        "UPDATE instruments SET consecutive_failures = 0 WHERE ticker = $1",
        [ticker],
      ),
      ticker,
    );
  }

  private mustUpdate(
    result: { rowCount: number | null },
    ticker: string,
  ): void {
    // null means the DRIVER did not report a count — that is an adapter
    // contract breach, not an unknown ticker; conflating them would brick
    // every bookkeeping update over such a driver with misleading errors.
    if (result.rowCount === null) {
      throw new Error(
        "SqlExecutor contract breach: the driver reported no row count for an UPDATE (see executor.ts — instrument updates require real counts)",
      );
    }
    if (result.rowCount === 0) {
      throw new Error(`Unknown instrument: ${ticker}`);
    }
  }

  /** Run a single-column instrument UPDATE, failing loudly on unknown tickers. */
  private async updateInstrument(
    sql: string,
    value: string,
    ticker: string,
  ): Promise<void> {
    this.mustUpdate(await this.sql.query(sql, [value, ticker]), ticker);
  }

  // ---- prices (append-only observations) ----

  /**
   * Validates every row via the shared write-edge guards (./validation.ts)
   * before any row is persisted — SQL's CHECK cannot express finiteness —
   * then inserts atomically inside one executor transaction.
   */
  async insertCloses(closes: readonly DailyClose[]): Promise<void> {
    validateCloses(closes);
    if (closes.length === 0) {
      return;
    }
    await this.sql.transaction(async (tx) => {
      for (const { ticker, date, close } of closes) {
        await tx.query(
          "INSERT INTO prices (ticker, date, close) VALUES ($1, $2, $3) ON CONFLICT (ticker, date) DO NOTHING",
          [ticker, date, close],
        );
      }
    });
  }

  async getCloses(
    ticker: string,
    from?: IsoDate,
    to?: IsoDate,
  ): Promise<DailyClose[]> {
    const { rows } = await this.sql.query(
      `SELECT ticker, date, close FROM prices
       WHERE ticker = $1
         AND ($2::text IS NULL OR date >= $2)
         AND ($3::text IS NULL OR date <= $3)
       ORDER BY date`,
      [ticker, dateBound("from", from), dateBound("to", to)],
    );
    return rows as unknown as DailyClose[];
  }

  async lastNCloses(
    ticker: string,
    n: number,
    asOf?: IsoDate,
  ): Promise<DailyClose[]> {
    assertNonNegativeInteger("n", n);
    const { rows } = await this.sql.query(
      `SELECT ticker, date, close FROM prices
       WHERE ticker = $1 AND ($2::text IS NULL OR date <= $2)
       ORDER BY date DESC LIMIT $3`,
      [ticker, dateBound("asOf", asOf), n],
    );
    return (rows as unknown as DailyClose[]).reverse();
  }

  async latestClose(
    ticker: string,
    asOf?: IsoDate,
  ): Promise<DailyClose | undefined> {
    const { rows } = await this.sql.query(
      `SELECT ticker, date, close FROM prices
       WHERE ticker = $1 AND ($2::text IS NULL OR date <= $2)
       ORDER BY date DESC LIMIT 1`,
      [ticker, dateBound("asOf", asOf)],
    );
    return rows[0] as DailyClose | undefined;
  }

  // ---- metadata snapshots (append-only observations) ----

  async insertAnalystSnapshot(snapshot: AnalystSnapshot): Promise<void> {
    validateAnalystSnapshot(snapshot);
    await this.sql.query(
      "INSERT INTO analyst_snapshots (ticker, as_of, median_target, num_analysts) VALUES ($1, $2, $3, $4) ON CONFLICT (ticker, as_of) DO NOTHING",
      [
        snapshot.ticker,
        snapshot.asOf,
        snapshot.medianTarget,
        snapshot.numAnalysts,
      ],
    );
  }

  async latestAnalystSnapshot(
    ticker: string,
    asOf?: IsoDate,
  ): Promise<AnalystSnapshot | undefined> {
    const { rows } = await this.sql.query(
      `SELECT ticker, as_of AS "asOf", median_target AS "medianTarget",
              num_analysts AS "numAnalysts"
       FROM analyst_snapshots
       WHERE ticker = $1 AND ($2::text IS NULL OR as_of <= $2)
       ORDER BY as_of DESC LIMIT 1`,
      [ticker, dateBound("asOf", asOf)],
    );
    return rows[0] as AnalystSnapshot | undefined;
  }

  async insertEarningsSnapshot(snapshot: EarningsSnapshot): Promise<void> {
    validateEarningsSnapshot(snapshot);
    await this.sql.query(
      "INSERT INTO earnings_snapshots (ticker, as_of, next_earnings_date) VALUES ($1, $2, $3) ON CONFLICT (ticker, as_of) DO NOTHING",
      [snapshot.ticker, snapshot.asOf, snapshot.nextEarningsDate],
    );
  }

  async latestEarningsSnapshot(
    ticker: string,
    asOf?: IsoDate,
  ): Promise<EarningsSnapshot | undefined> {
    const { rows } = await this.sql.query(
      `SELECT ticker, as_of AS "asOf", next_earnings_date AS "nextEarningsDate"
       FROM earnings_snapshots
       WHERE ticker = $1 AND ($2::text IS NULL OR as_of <= $2)
       ORDER BY as_of DESC LIMIT 1`,
      [ticker, dateBound("asOf", asOf)],
    );
    return rows[0] as EarningsSnapshot | undefined;
  }

  async insertDividendSnapshot(snapshot: DividendSnapshot): Promise<void> {
    validateDividendSnapshot(snapshot);
    await this.sql.query(
      "INSERT INTO dividend_snapshots (ticker, as_of, next_ex_div_date) VALUES ($1, $2, $3) ON CONFLICT (ticker, as_of) DO NOTHING",
      [snapshot.ticker, snapshot.asOf, snapshot.nextExDivDate],
    );
  }

  async latestDividendSnapshot(
    ticker: string,
    asOf?: IsoDate,
  ): Promise<DividendSnapshot | undefined> {
    const { rows } = await this.sql.query(
      `SELECT ticker, as_of AS "asOf", next_ex_div_date AS "nextExDivDate"
       FROM dividend_snapshots
       WHERE ticker = $1 AND ($2::text IS NULL OR as_of <= $2)
       ORDER BY as_of DESC LIMIT 1`,
      [ticker, dateBound("asOf", asOf)],
    );
    return rows[0] as DividendSnapshot | undefined;
  }
}
