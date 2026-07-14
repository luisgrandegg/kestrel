import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll } from "vitest";
import { describeRepositoryContract } from "../test-support/repositoryContract.js";
import type { SqlExecutor, SqlQueryable, SqlRow } from "./executor.js";
import { PostgresRepository } from "./postgres.js";

/**
 * Postgres engine run of the shared StorageRepository contract suite
 * (../test-support/repositoryContract.ts), backed by an in-process PGlite
 * (real Postgres compiled to WASM — no server, no mocks) adapted to the
 * SqlExecutor seam the same way the composition root adapts pg.Pool.
 *
 * One PGlite instance is shared across the suite (boot is the slow part);
 * each makeRepo drops the tables and re-applies the Supabase migration —
 * read from supabase/migrations/00001_init.sql on disk, the single source
 * of truth for the Postgres schema — so every test starts clean.
 */

const MIGRATION = readFileSync(
  new URL("../../../../supabase/migrations/00001_init.sql", import.meta.url),
  "utf8",
);

const TABLES = [
  "instruments",
  "prices",
  "analyst_snapshots",
  "earnings_snapshots",
  "dividend_snapshots",
];

const db = new PGlite();

/** The shape shared by a PGlite instance and its transaction handle. */
interface PgliteQueryable {
  query<T>(
    query: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; affectedRows?: number }>;
}

function adapt(pglite: PgliteQueryable): SqlQueryable {
  return {
    async query(text, params) {
      const result = await pglite.query<SqlRow>(
        text,
        params === undefined ? undefined : [...params],
      );
      return { rows: result.rows, rowCount: result.affectedRows ?? null };
    },
  };
}

const executor: SqlExecutor = {
  ...adapt(db),
  async transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T> {
    // PGlite types the callback result as possibly undefined (its manual
    // tx.rollback() escape hatch, which we never use), hence the cast.
    return (await db.transaction((tx) => fn(adapt(tx)))) as T;
  },
  end: () => db.close(),
};

// Boot the WASM runtime inside the (longer) hook budget, not the first
// test's — cold start can exceed the per-test timeout.
beforeAll(() => db.waitReady);

describeRepositoryContract("postgres", async () => {
  await db.exec(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE;`);
  await db.exec(MIGRATION);
  return new PostgresRepository(executor);
});

afterAll(() => db.close());
