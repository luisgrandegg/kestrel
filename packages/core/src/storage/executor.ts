/**
 * Minimal SQL-executor seam for the Postgres repository (ADR-0011).
 *
 * `PostgresRepository` types against these interfaces so @kestrel/core needs
 * no database-driver dependency: the composition root adapts `pg.Pool`
 * (query → rows/rowCount, transaction → a client checked out with
 * BEGIN/COMMIT/ROLLBACK) and the contract tests adapt an in-process PGlite
 * instance (query → rows/affectedRows, transaction → PGlite's own). Swapping
 * drivers touches only that adapter, never the repository.
 */

/** One result row, keyed by (aliased) column name. */
export interface SqlRow {
  [column: string]: unknown;
}

/**
 * Anything that can run one parameterized statement ($1-style positional
 * params). `rowCount` is the driver-reported affected-row count for writes
 * (`null` when the driver does not report one); reads use `rows`.
 */
export interface SqlQueryable {
  query(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: SqlRow[]; rowCount: number | null }>;
}

/**
 * A queryable with transaction and lifecycle control — what the repository
 * is constructed with. `transaction` runs `fn` atomically: every statement
 * issued through the passed queryable commits together or not at all.
 */
export interface SqlExecutor extends SqlQueryable {
  transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}
