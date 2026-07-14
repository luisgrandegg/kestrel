import type { SqlExecutor, SqlQueryable } from "@kestrel/core/storage/executor";
import pg from "pg";

/**
 * pg.Pool → SqlExecutor adapter — the driver edge of the storage seam
 * (ADR-0011). @kestrel/core's PostgresRepository types against the
 * driver-agnostic SqlExecutor (core/src/storage/executor.ts); this module
 * is the one place in the web app that touches the `pg` driver, and it
 * lives in src/app/ because driver adapters belong with the composition
 * root (the only-storage-touches-the-database lint rule).
 *
 * The pool is a module-level lazy singleton: on Vercel a warm serverless
 * instance reuses it across invocations instead of reconnecting per
 * request, and nothing reads DATABASE_URL at import time — `next build`
 * must succeed in an env without it, so the fail-loud check runs on first
 * QUERY, not first import.
 */

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (pool === undefined) {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString === "") {
      throw new Error(
        "DATABASE_URL is not set — the web app needs the Supabase Postgres " +
          "connection string (use the Transaction-pooler URL; see docs/deploy.md)",
      );
    }
    pool = new pg.Pool({ connectionString });
  }
  return pool;
}

/**
 * Adapt one pg queryable (pool or checked-out client) to the seam shape:
 * query → rows/rowCount. pg reports real rowCounts for UPDATEs, which the
 * repository's unknown-ticker detection requires (executor.ts contract).
 */
function asQueryable(queryable: pg.Pool | pg.PoolClient): SqlQueryable {
  return {
    async query(text, params) {
      const result = await queryable.query(
        text,
        params === undefined ? undefined : [...params],
      );
      return { rows: result.rows, rowCount: result.rowCount };
    },
  };
}

/** The SqlExecutor the web composition root hands to PostgresRepository. */
export function poolExecutor(): SqlExecutor {
  return {
    query(text, params) {
      return asQueryable(getPool()).query(text, params);
    },
    // Transactions run on a single checked-out client with explicit
    // BEGIN/COMMIT/ROLLBACK (a pool-level BEGIN would land on an arbitrary
    // connection); the client is always released, even on rollback failure.
    async transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T> {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const result = await fn(asQueryable(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async end() {
      const current = pool;
      pool = undefined;
      if (current !== undefined) {
        await current.end();
      }
    },
  };
}
