import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves supabase/migrations/00002_auth.sql (item 020) is valid Postgres and
 * creates better-auth's expected shape, run against a real Postgres engine
 * (in-process PGlite — the same engine the storage contract suite uses).
 * The DDL was transcribed from better-auth 1.6's migration generator; this
 * guards the transcription against drift and typos.
 */

const MIGRATION = readFileSync(
  new URL("../../../../../supabase/migrations/00002_auth.sql", import.meta.url),
  "utf8",
);

const db = new PGlite();

beforeAll(async () => {
  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db.close();
});

async function columns(
  table: string,
): Promise<Map<string, { type: string; nullable: boolean }>> {
  const result = await db.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_name = $1`,
    [table],
  );
  return new Map(
    result.rows.map((r) => [
      r.column_name,
      { type: r.data_type, nullable: r.is_nullable === "YES" },
    ]),
  );
}

describe("00002_auth.sql — better-auth schema", () => {
  it("creates all four core tables", async () => {
    const result = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`,
    );
    expect(result.rows.map((r) => r.table_name)).toEqual([
      "account",
      "session",
      "user",
      "verification",
    ]);
  });

  it("types user columns as better-auth expects (text/boolean/timestamptz, nullable image)", async () => {
    const cols = await columns("user");
    expect(cols.get("id")).toEqual({ type: "text", nullable: false });
    expect(cols.get("email")).toEqual({ type: "text", nullable: false });
    expect(cols.get("emailVerified")).toEqual({
      type: "boolean",
      nullable: false,
    });
    expect(cols.get("image")).toEqual({ type: "text", nullable: true });
    expect(cols.get("createdAt")?.type).toBe("timestamp with time zone");
    expect(cols.get("createdAt")?.nullable).toBe(false);
  });

  it("makes session.userId a non-null column and expiresAt required", async () => {
    const cols = await columns("session");
    expect(cols.get("userId")).toEqual({ type: "text", nullable: false });
    expect(cols.get("expiresAt")).toEqual({
      type: "timestamp with time zone",
      nullable: false,
    });
    expect(cols.get("token")?.nullable).toBe(false);
  });

  it("keeps account OAuth-token columns nullable", async () => {
    const cols = await columns("account");
    for (const nullable of [
      "accessToken",
      "refreshToken",
      "idToken",
      "accessTokenExpiresAt",
      "scope",
      "password",
    ]) {
      expect(cols.get(nullable)?.nullable).toBe(true);
    }
    expect(cols.get("providerId")?.nullable).toBe(false);
    expect(cols.get("accountId")?.nullable).toBe(false);
  });

  it("cascades session/account deletes when a user is removed (FK on delete cascade)", async () => {
    await db.exec(`
      insert into "user" ("id","name","email","emailVerified")
        values ('u1','Ada','ada@example.com', true);
      insert into "session" ("id","expiresAt","token","userId")
        values ('s1', now() + interval '1 day', 'tok1', 'u1');
      insert into "account" ("id","accountId","providerId","userId")
        values ('a1','google-sub-1','google','u1');
    `);
    await db.exec(`delete from "user" where "id" = 'u1';`);

    const sessions = await db.query(`select 1 from "session"`);
    const accounts = await db.query(`select 1 from "account"`);
    expect(sessions.rows).toHaveLength(0);
    expect(accounts.rows).toHaveLength(0);
  });

  it("enforces the unique email constraint", async () => {
    await db.exec(`
      insert into "user" ("id","name","email","emailVerified")
        values ('u2','Grace','grace@example.com', true);
    `);
    await expect(
      db.exec(`
        insert into "user" ("id","name","email","emailVerified")
          values ('u3','Impostor','grace@example.com', false);
      `),
    ).rejects.toThrow();
  });
});
