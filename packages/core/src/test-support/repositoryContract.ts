import { describe, expect, it } from "vitest";
import type { StorageRepository } from "../storage/port.js";

/**
 * The StorageRepository contract suite (backlog item 008; ADR-0011), run
 * verbatim against every engine — SQLite (storage/repository.test.ts) and
 * Postgres (storage/postgres.test.ts) — so the engines cannot drift. Every
 * case goes through the port only. The M2 Definition of Done: writing the
 * same (ticker,date) / (ticker,as_of) twice is a no-op; latest-snapshot
 * queries return max(as_of); prior rows are retained.
 *
 * `makeRepo` must return a repository over a fresh, empty store each call.
 */
export function describeRepositoryContract(
  engine: string,
  makeRepo: () => Promise<StorageRepository>,
): void {
  const repo = makeRepo;

  describe(`${engine}: prices — append-only, insert-or-ignore`, () => {
    it("writing the same (ticker, date) twice is a no-op that keeps the original value", async () => {
      const r = await repo();
      await r.insertCloses([
        { ticker: "ACME", date: "2026-07-10", close: 100 },
      ]);
      await r.insertCloses([
        { ticker: "ACME", date: "2026-07-10", close: 999 },
      ]);
      const closes = await r.getCloses("ACME");
      expect(closes).toHaveLength(1);
      expect(closes[0]?.close).toBe(100);
    });

    it("returns chronological closes, optionally bounded inclusively", async () => {
      const r = await repo();
      await r.insertCloses([
        { ticker: "ACME", date: "2026-07-12", close: 103 },
        { ticker: "ACME", date: "2026-07-10", close: 101 },
        { ticker: "ACME", date: "2026-07-11", close: 102 },
        { ticker: "OTHER", date: "2026-07-10", close: 55 },
      ]);
      expect((await r.getCloses("ACME")).map((c) => c.date)).toEqual([
        "2026-07-10",
        "2026-07-11",
        "2026-07-12",
      ]);
      expect(
        (await r.getCloses("ACME", "2026-07-11", "2026-07-12")).map(
          (c) => c.close,
        ),
      ).toEqual([102, 103]);
      expect(
        (await r.getCloses("ACME", "2026-07-11")).map((c) => c.close),
      ).toEqual([102, 103]);
    });

    it("latestClose returns the max(date) row", async () => {
      const r = await repo();
      await r.insertCloses([
        { ticker: "ACME", date: "2026-07-10", close: 101 },
        { ticker: "ACME", date: "2026-07-12", close: 103 },
        { ticker: "ACME", date: "2026-07-11", close: 102 },
      ]);
      expect(await r.latestClose("ACME")).toEqual({
        ticker: "ACME",
        date: "2026-07-12",
        close: 103,
      });
      expect(await r.latestClose("MISSING")).toBeUndefined();
    });

    it("rejects non-positive and non-finite closes (DailyClose contract)", async () => {
      const r = await repo();
      for (const close of [0, -5, Number.POSITIVE_INFINITY, Number.NaN]) {
        await expect(
          r.insertCloses([{ ticker: "ACME", date: "2026-07-10", close }]),
        ).rejects.toThrow(RangeError);
      }
      // Nothing was persisted by any rejected write.
      expect(await r.getCloses("ACME")).toHaveLength(0);
    });

    it("lastNCloses returns the trailing n closes chronologically, honoring asOf", async () => {
      const r = await repo();
      await r.insertCloses([
        { ticker: "ACME", date: "2026-07-08", close: 100 },
        { ticker: "ACME", date: "2026-07-09", close: 101 },
        { ticker: "ACME", date: "2026-07-10", close: 102 },
        { ticker: "ACME", date: "2026-07-11", close: 103 },
      ]);
      expect((await r.lastNCloses("ACME", 2)).map((c) => c.close)).toEqual([
        102, 103,
      ]);
      // asOf bounds the window with no lookahead.
      expect(
        (await r.lastNCloses("ACME", 2, "2026-07-10")).map((c) => c.close),
      ).toEqual([101, 102]);
      // n larger than history returns everything; n = 0 returns nothing.
      expect(await r.lastNCloses("ACME", 10)).toHaveLength(4);
      expect(await r.lastNCloses("ACME", 0)).toEqual([]);
      await expect(r.lastNCloses("ACME", -1)).rejects.toThrow(RangeError);
      await expect(r.lastNCloses("ACME", 2.5)).rejects.toThrow(RangeError);
    });

    it("latestClose honors an as-of bound (no lookahead)", async () => {
      const r = await repo();
      await r.insertCloses([
        { ticker: "ACME", date: "2026-07-10", close: 101 },
        { ticker: "ACME", date: "2026-07-12", close: 103 },
      ]);
      expect((await r.latestClose("ACME", "2026-07-11"))?.close).toBe(101);
      expect(await r.latestClose("ACME", "2026-07-09")).toBeUndefined();
    });

    it("a batch is atomic: one bad row rolls back the whole batch", async () => {
      const r = await repo();
      await expect(
        r.insertCloses([
          { ticker: "ACME", date: "2026-07-10", close: 100 },
          { ticker: "ACME", date: "2026-07-11", close: -1 },
        ]),
      ).rejects.toThrow();
      expect(await r.getCloses("ACME")).toHaveLength(0);
    });

    it("rejects a malformed as-of read bound instead of silently reading the future", async () => {
      const r = await repo();
      await r.insertCloses([
        { ticker: "ACME", date: "2026-12-31", close: 100 },
      ]);
      // Lexicographically '2026-12-31' <= '2026-7-1' — unchecked, this bound
      // would return a December close for a July as-of date.
      await expect(r.latestClose("ACME", "2026-7-1")).rejects.toThrow(
        RangeError,
      );
      await expect(r.lastNCloses("ACME", 5, "2026-7-1")).rejects.toThrow(
        RangeError,
      );
      await expect(r.getCloses("ACME", "2026-7-1")).rejects.toThrow(RangeError);
      await expect(r.latestAnalystSnapshot("ACME", "2026-7-1")).rejects.toThrow(
        RangeError,
      );
      await expect(
        r.latestEarningsSnapshot("ACME", "2026-7-1"),
      ).rejects.toThrow(RangeError);
      await expect(
        r.latestDividendSnapshot("ACME", "2026-7-1"),
      ).rejects.toThrow(RangeError);
    });
  });

  describe(`${engine}: metadata snapshots — append-only, latest = max(as_of)`, () => {
    it("writing the same (ticker, as_of) twice is a no-op that keeps the original", async () => {
      const r = await repo();
      await r.insertAnalystSnapshot({
        ticker: "ACME",
        asOf: "2026-07-10",
        medianTarget: 120,
        numAnalysts: 8,
      });
      await r.insertAnalystSnapshot({
        ticker: "ACME",
        asOf: "2026-07-10",
        medianTarget: 999,
        numAnalysts: 1,
      });
      expect(await r.latestAnalystSnapshot("ACME")).toEqual({
        ticker: "ACME",
        asOf: "2026-07-10",
        medianTarget: 120,
        numAnalysts: 8,
      });
    });

    it("latestAnalystSnapshot returns max(as_of); prior rows stay readable through the as-of bound", async () => {
      const r = await repo();
      await r.insertAnalystSnapshot({
        ticker: "ACME",
        asOf: "2026-07-01",
        medianTarget: 110,
        numAnalysts: 7,
      });
      await r.insertAnalystSnapshot({
        ticker: "ACME",
        asOf: "2026-07-10",
        medianTarget: 130,
        numAnalysts: 9,
      });
      expect((await r.latestAnalystSnapshot("ACME"))?.medianTarget).toBe(130);
      // The prior observation is still readable: "what did this look like on
      // date X" (CONSTITUTION §3.1-3.2) — the no-lookahead bounded read.
      expect(await r.latestAnalystSnapshot("ACME", "2026-07-05")).toEqual({
        ticker: "ACME",
        asOf: "2026-07-01",
        medianTarget: 110,
        numAnalysts: 7,
      });
      expect(
        await r.latestAnalystSnapshot("ACME", "2026-06-30"),
      ).toBeUndefined();
      // Inserting an older as_of later never displaces the latest.
      await r.insertAnalystSnapshot({
        ticker: "ACME",
        asOf: "2026-06-15",
        medianTarget: 90,
        numAnalysts: 5,
      });
      expect((await r.latestAnalystSnapshot("ACME"))?.asOf).toBe("2026-07-10");
      expect(
        (await r.latestAnalystSnapshot("ACME", "2026-06-20"))?.medianTarget,
      ).toBe(90);
    });

    it("earnings and dividend snapshots honor the as-of bound too", async () => {
      const r = await repo();
      await r.insertEarningsSnapshot({
        ticker: "ACME",
        asOf: "2026-07-01",
        nextEarningsDate: "2026-07-20",
      });
      await r.insertEarningsSnapshot({
        ticker: "ACME",
        asOf: "2026-07-10",
        nextEarningsDate: "2026-10-20",
      });
      expect(
        (await r.latestEarningsSnapshot("ACME", "2026-07-05"))
          ?.nextEarningsDate,
      ).toBe("2026-07-20");
      await r.insertDividendSnapshot({
        ticker: "ACME",
        asOf: "2026-07-01",
        nextExDivDate: "2026-07-15",
      });
      await r.insertDividendSnapshot({
        ticker: "ACME",
        asOf: "2026-07-10",
        nextExDivDate: "2026-10-15",
      });
      expect(
        (await r.latestDividendSnapshot("ACME", "2026-07-05"))?.nextExDivDate,
      ).toBe("2026-07-15");
    });

    it("earnings and dividend snapshots behave the same, including null event dates", async () => {
      const r = await repo();
      await r.insertEarningsSnapshot({
        ticker: "ACME",
        asOf: "2026-07-01",
        nextEarningsDate: "2026-07-20",
      });
      await r.insertEarningsSnapshot({
        ticker: "ACME",
        asOf: "2026-07-10",
        nextEarningsDate: null,
      });
      expect(await r.latestEarningsSnapshot("ACME")).toEqual({
        ticker: "ACME",
        asOf: "2026-07-10",
        nextEarningsDate: null,
      });

      await r.insertDividendSnapshot({
        ticker: "ACME",
        asOf: "2026-07-10",
        nextExDivDate: "2026-07-15",
      });
      await r.insertDividendSnapshot({
        ticker: "ACME",
        asOf: "2026-07-10",
        nextExDivDate: "2026-08-01",
      });
      expect((await r.latestDividendSnapshot("ACME"))?.nextExDivDate).toBe(
        "2026-07-15",
      );
      expect(await r.latestDividendSnapshot("MISSING")).toBeUndefined();
    });

    it("rejects malformed snapshot observations at the write edge — a bad append-only row would fail downstream forever", async () => {
      const r = await repo();
      const analyst = { ticker: "ACME", asOf: "2026-07-10", numAnalysts: 8 };
      // A zero/negative/non-finite target would blow up the implied-upside
      // metric on every future evaluation of every screen.
      await expect(
        r.insertAnalystSnapshot({ ...analyst, medianTarget: 0 }),
      ).rejects.toThrow(RangeError);
      await expect(
        r.insertAnalystSnapshot({ ...analyst, medianTarget: -5 }),
      ).rejects.toThrow(RangeError);
      await expect(
        r.insertAnalystSnapshot({ ...analyst, medianTarget: Number.NaN }),
      ).rejects.toThrow(RangeError);
      await expect(
        r.insertAnalystSnapshot({
          ticker: "ACME",
          asOf: "2026-07-10",
          medianTarget: 100,
          numAnalysts: 2.5,
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        r.insertAnalystSnapshot({
          ticker: "ACME",
          asOf: "2026-7-10", // not zero-padded: would sort wrong forever
          medianTarget: 100,
          numAnalysts: 8,
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        r.insertEarningsSnapshot({
          ticker: "ACME",
          asOf: "2026-07-10",
          nextEarningsDate: "2026-7-20",
        }),
      ).rejects.toThrow(RangeError);
      // Well-formed but impossible: reading it back through daysToEvent would
      // otherwise crash every screen evaluation, forever (append-only).
      await expect(
        r.insertEarningsSnapshot({
          ticker: "ACME",
          asOf: "2026-07-10",
          nextEarningsDate: "2026-02-30",
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        r.insertDividendSnapshot({
          ticker: "ACME",
          asOf: "2026-7-10",
          nextExDivDate: null,
        }),
      ).rejects.toThrow(RangeError);
      expect(await r.latestAnalystSnapshot("ACME")).toBeUndefined();
    });
  });

  describe(`${engine}: instruments — lifecycle bookkeeping`, () => {
    it("addInstrument registers as pending; re-adding is a no-op", async () => {
      const r = await repo();
      await r.addInstrument("ACME", "2026-07-10");
      await r.setInstrumentState("ACME", "ready");
      await r.addInstrument("ACME", "2026-07-12");
      expect(await r.getInstrument("ACME")).toEqual({
        ticker: "ACME",
        currency: null,
        state: "ready",
        addedAt: "2026-07-10",
        lastPriceSync: null,
        lastMetadataSync: null,
        consecutiveFailures: 0,
      });
    });

    it("updates state, currency, and sync timestamps", async () => {
      const r = await repo();
      await r.addInstrument("ACME", "2026-07-10");
      await r.setInstrumentState("ACME", "backfilling");
      await r.setInstrumentCurrency("ACME", "USD");
      await r.recordPriceSync("ACME", "2026-07-11");
      await r.recordMetadataSync("ACME", "2026-07-12");
      expect(await r.getInstrument("ACME")).toEqual({
        ticker: "ACME",
        currency: "USD",
        state: "backfilling",
        addedAt: "2026-07-10",
        lastPriceSync: "2026-07-11",
        lastMetadataSync: "2026-07-12",
        consecutiveFailures: 0,
      });
    });

    it("rejects an invalid lifecycle state at the schema level", async () => {
      const r = await repo();
      await r.addInstrument("ACME", "2026-07-10");
      await expect(
        r.setInstrumentState("ACME", "exploded" as never),
      ).rejects.toThrow();
    });

    it("updating an unknown instrument fails loudly", async () => {
      const r = await repo();
      await expect(r.setInstrumentState("GHOST", "ready")).rejects.toThrow(
        /Unknown instrument: GHOST/,
      );
      await expect(r.recordPriceSync("GHOST", "2026-07-10")).rejects.toThrow(
        /Unknown instrument/,
      );
    });

    it("tracks the consecutive-failure streak: increment returns the count, success resets", async () => {
      const r = await repo();
      await r.addInstrument("ACME", "2026-07-10");
      expect(await r.incrementFailures("ACME")).toBe(1);
      expect(await r.incrementFailures("ACME")).toBe(2);
      expect((await r.getInstrument("ACME"))?.consecutiveFailures).toBe(2);
      await r.resetFailures("ACME");
      expect((await r.getInstrument("ACME"))?.consecutiveFailures).toBe(0);
      await expect(r.incrementFailures("GHOST")).rejects.toThrow(
        /Unknown instrument/,
      );
      await expect(r.resetFailures("GHOST")).rejects.toThrow(
        /Unknown instrument/,
      );
    });

    it("lists instruments, optionally filtered by state", async () => {
      const r = await repo();
      await r.addInstrument("AAA", "2026-07-10");
      await r.addInstrument("BBB", "2026-07-10");
      await r.setInstrumentState("BBB", "ready");
      expect((await r.listInstruments()).map((i) => i.ticker)).toEqual([
        "AAA",
        "BBB",
      ]);
      expect((await r.listInstruments("ready")).map((i) => i.ticker)).toEqual([
        "BBB",
      ]);
      expect(await r.listInstruments("error")).toEqual([]);
    });
  });
}
