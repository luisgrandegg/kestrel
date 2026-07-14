import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

// The storage-seam migrations (00001 market data + 00003 user watchlists).
// 00002 is better-auth's own schema — beside this seam, not part of the port.
const MIGRATION = [
  "../../../../supabase/migrations/00001_init.sql",
  "../../../../supabase/migrations/00003_user_watchlist.sql",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");

const TABLES = [
  "instruments",
  "prices",
  "analyst_snapshots",
  "earnings_snapshots",
  "dividend_snapshots",
  "user_watchlist",
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
  // The PGlite instance is SHARED across the whole suite: a repository's
  // close() must not tear it down for later tests (the port's close() is
  // still contract-covered — the SQLite run exercises the real thing).
  // afterAll below closes the raw instance exactly once.
  end: () => Promise.resolve(),
};

// Boot the WASM runtime inside the (longer) hook budget, not the first
// test's — cold start can exceed the per-test timeout.
beforeAll(() => db.waitReady);

const makeRepo = async (): Promise<PostgresRepository> => {
  await db.exec(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE;`);
  await db.exec(MIGRATION);
  return new PostgresRepository(executor);
};

describeRepositoryContract("postgres", makeRepo);

describe("PostgresRepository — transaction rollback (engine-specific)", () => {
  it("insertCloses rolls back the whole batch when a statement fails mid-transaction", async () => {
    const repo = await makeRepo();
    // Wrap the executor so the SECOND insert inside the transaction throws
    // AT THE SQL LAYER — past the shared validation, which the contract's
    // atomicity test already covers. This exercises the real BEGIN/ROLLBACK
    // path that a no-op transaction wrapper would fake green.
    let inserts = 0;
    const failing: SqlExecutor = {
      ...executor,
      transaction: <T>(fn: (tx: SqlQueryable) => Promise<T>) =>
        executor.transaction((tx) =>
          fn({
            query(text, params) {
              inserts += 1;
              if (inserts === 2) {
                throw new Error("simulated driver failure mid-batch");
              }
              return tx.query(text, params);
            },
          }),
        ),
    };
    const failingRepo = new PostgresRepository(failing);
    await expect(
      failingRepo.insertCloses([
        { ticker: "ACME", date: "2026-07-10", close: 100 },
        { ticker: "ACME", date: "2026-07-11", close: 101 },
      ]),
    ).rejects.toThrow("simulated driver failure mid-batch");
    // Nothing from the batch persisted — including the FIRST row, which had
    // already been inserted inside the aborted transaction.
    expect(await repo.getCloses("ACME")).toHaveLength(0);
  });
});

afterAll(() => db.close());
