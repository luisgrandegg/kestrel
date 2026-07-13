import { describe, expect, it } from "vitest";
import { Repository } from "./repository.js";

/**
 * Repository tests (backlog item 008). The M2 Definition of Done:
 * writing the same (ticker,date) / (ticker,as_of) twice is a no-op;
 * latest-snapshot queries return max(as_of); prior rows are retained.
 */

const repo = () => new Repository(":memory:");

describe("prices — append-only, insert-or-ignore", () => {
  it("writing the same (ticker, date) twice is a no-op that keeps the original value", () => {
    const r = repo();
    r.insertCloses([{ ticker: "ACME", date: "2026-07-10", close: 100 }]);
    r.insertCloses([{ ticker: "ACME", date: "2026-07-10", close: 999 }]);
    const closes = r.getCloses("ACME");
    expect(closes).toHaveLength(1);
    expect(closes[0]?.close).toBe(100);
  });

  it("returns chronological closes, optionally bounded inclusively", () => {
    const r = repo();
    r.insertCloses([
      { ticker: "ACME", date: "2026-07-12", close: 103 },
      { ticker: "ACME", date: "2026-07-10", close: 101 },
      { ticker: "ACME", date: "2026-07-11", close: 102 },
      { ticker: "OTHER", date: "2026-07-10", close: 55 },
    ]);
    expect(r.getCloses("ACME").map((c) => c.date)).toEqual([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);
    expect(
      r.getCloses("ACME", "2026-07-11", "2026-07-12").map((c) => c.close),
    ).toEqual([102, 103]);
    expect(r.getCloses("ACME", "2026-07-11").map((c) => c.close)).toEqual([
      102, 103,
    ]);
  });

  it("latestClose returns the max(date) row", () => {
    const r = repo();
    r.insertCloses([
      { ticker: "ACME", date: "2026-07-10", close: 101 },
      { ticker: "ACME", date: "2026-07-12", close: 103 },
      { ticker: "ACME", date: "2026-07-11", close: 102 },
    ]);
    expect(r.latestClose("ACME")).toEqual({
      ticker: "ACME",
      date: "2026-07-12",
      close: 103,
    });
    expect(r.latestClose("MISSING")).toBeUndefined();
  });

  it("rejects non-positive and non-finite closes (DailyClose contract)", () => {
    const r = repo();
    for (const close of [0, -5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() =>
        r.insertCloses([{ ticker: "ACME", date: "2026-07-10", close }]),
      ).toThrow(RangeError);
    }
    // Nothing was persisted by any rejected write.
    expect(r.getCloses("ACME")).toHaveLength(0);
  });

  it("lastNCloses returns the trailing n closes chronologically, honoring asOf", () => {
    const r = repo();
    r.insertCloses([
      { ticker: "ACME", date: "2026-07-08", close: 100 },
      { ticker: "ACME", date: "2026-07-09", close: 101 },
      { ticker: "ACME", date: "2026-07-10", close: 102 },
      { ticker: "ACME", date: "2026-07-11", close: 103 },
    ]);
    expect(r.lastNCloses("ACME", 2).map((c) => c.close)).toEqual([102, 103]);
    // asOf bounds the window with no lookahead.
    expect(r.lastNCloses("ACME", 2, "2026-07-10").map((c) => c.close)).toEqual([
      101, 102,
    ]);
    // n larger than history returns everything; n = 0 returns nothing.
    expect(r.lastNCloses("ACME", 10)).toHaveLength(4);
    expect(r.lastNCloses("ACME", 0)).toEqual([]);
    expect(() => r.lastNCloses("ACME", -1)).toThrow(RangeError);
    expect(() => r.lastNCloses("ACME", 2.5)).toThrow(RangeError);
  });

  it("latestClose honors an as-of bound (no lookahead)", () => {
    const r = repo();
    r.insertCloses([
      { ticker: "ACME", date: "2026-07-10", close: 101 },
      { ticker: "ACME", date: "2026-07-12", close: 103 },
    ]);
    expect(r.latestClose("ACME", "2026-07-11")?.close).toBe(101);
    expect(r.latestClose("ACME", "2026-07-09")).toBeUndefined();
  });

  it("a batch is atomic: one bad row rolls back the whole batch", () => {
    const r = repo();
    expect(() =>
      r.insertCloses([
        { ticker: "ACME", date: "2026-07-10", close: 100 },
        { ticker: "ACME", date: "2026-07-11", close: -1 },
      ]),
    ).toThrow();
    expect(r.getCloses("ACME")).toHaveLength(0);
  });

  it("rejects a malformed as-of read bound instead of silently reading the future", () => {
    const r = repo();
    r.insertCloses([{ ticker: "ACME", date: "2026-12-31", close: 100 }]);
    // Lexicographically '2026-12-31' <= '2026-7-1' — unchecked, this bound
    // would return a December close for a July as-of date.
    expect(() => r.latestClose("ACME", "2026-7-1")).toThrow(RangeError);
    expect(() => r.lastNCloses("ACME", 5, "2026-7-1")).toThrow(RangeError);
    expect(() => r.getCloses("ACME", "2026-7-1")).toThrow(RangeError);
    expect(() => r.latestAnalystSnapshot("ACME", "2026-7-1")).toThrow(
      RangeError,
    );
    expect(() => r.latestEarningsSnapshot("ACME", "2026-7-1")).toThrow(
      RangeError,
    );
    expect(() => r.latestDividendSnapshot("ACME", "2026-7-1")).toThrow(
      RangeError,
    );
  });
});

describe("metadata snapshots — append-only, latest = max(as_of)", () => {
  it("writing the same (ticker, as_of) twice is a no-op that keeps the original", () => {
    const r = repo();
    r.insertAnalystSnapshot({
      ticker: "ACME",
      asOf: "2026-07-10",
      medianTarget: 120,
      numAnalysts: 8,
    });
    r.insertAnalystSnapshot({
      ticker: "ACME",
      asOf: "2026-07-10",
      medianTarget: 999,
      numAnalysts: 1,
    });
    expect(r.latestAnalystSnapshot("ACME")).toEqual({
      ticker: "ACME",
      asOf: "2026-07-10",
      medianTarget: 120,
      numAnalysts: 8,
    });
  });

  it("latestAnalystSnapshot returns max(as_of); prior rows stay readable through the as-of bound", () => {
    const r = repo();
    r.insertAnalystSnapshot({
      ticker: "ACME",
      asOf: "2026-07-01",
      medianTarget: 110,
      numAnalysts: 7,
    });
    r.insertAnalystSnapshot({
      ticker: "ACME",
      asOf: "2026-07-10",
      medianTarget: 130,
      numAnalysts: 9,
    });
    expect(r.latestAnalystSnapshot("ACME")?.medianTarget).toBe(130);
    // The prior observation is still readable: "what did this look like on
    // date X" (CONSTITUTION §3.1-3.2) — the no-lookahead bounded read.
    expect(r.latestAnalystSnapshot("ACME", "2026-07-05")).toEqual({
      ticker: "ACME",
      asOf: "2026-07-01",
      medianTarget: 110,
      numAnalysts: 7,
    });
    expect(r.latestAnalystSnapshot("ACME", "2026-06-30")).toBeUndefined();
    // Inserting an older as_of later never displaces the latest.
    r.insertAnalystSnapshot({
      ticker: "ACME",
      asOf: "2026-06-15",
      medianTarget: 90,
      numAnalysts: 5,
    });
    expect(r.latestAnalystSnapshot("ACME")?.asOf).toBe("2026-07-10");
    expect(r.latestAnalystSnapshot("ACME", "2026-06-20")?.medianTarget).toBe(
      90,
    );
  });

  it("earnings and dividend snapshots honor the as-of bound too", () => {
    const r = repo();
    r.insertEarningsSnapshot({
      ticker: "ACME",
      asOf: "2026-07-01",
      nextEarningsDate: "2026-07-20",
    });
    r.insertEarningsSnapshot({
      ticker: "ACME",
      asOf: "2026-07-10",
      nextEarningsDate: "2026-10-20",
    });
    expect(
      r.latestEarningsSnapshot("ACME", "2026-07-05")?.nextEarningsDate,
    ).toBe("2026-07-20");
    r.insertDividendSnapshot({
      ticker: "ACME",
      asOf: "2026-07-01",
      nextExDivDate: "2026-07-15",
    });
    r.insertDividendSnapshot({
      ticker: "ACME",
      asOf: "2026-07-10",
      nextExDivDate: "2026-10-15",
    });
    expect(r.latestDividendSnapshot("ACME", "2026-07-05")?.nextExDivDate).toBe(
      "2026-07-15",
    );
  });

  it("earnings and dividend snapshots behave the same, including null event dates", () => {
    const r = repo();
    r.insertEarningsSnapshot({
      ticker: "ACME",
      asOf: "2026-07-01",
      nextEarningsDate: "2026-07-20",
    });
    r.insertEarningsSnapshot({
      ticker: "ACME",
      asOf: "2026-07-10",
      nextEarningsDate: null,
    });
    expect(r.latestEarningsSnapshot("ACME")).toEqual({
      ticker: "ACME",
      asOf: "2026-07-10",
      nextEarningsDate: null,
    });

    r.insertDividendSnapshot({
      ticker: "ACME",
      asOf: "2026-07-10",
      nextExDivDate: "2026-07-15",
    });
    r.insertDividendSnapshot({
      ticker: "ACME",
      asOf: "2026-07-10",
      nextExDivDate: "2026-08-01",
    });
    expect(r.latestDividendSnapshot("ACME")?.nextExDivDate).toBe("2026-07-15");
    expect(r.latestDividendSnapshot("MISSING")).toBeUndefined();
  });

  it("rejects malformed snapshot observations at the write edge — a bad append-only row would fail downstream forever", () => {
    const r = repo();
    const analyst = { ticker: "ACME", asOf: "2026-07-10", numAnalysts: 8 };
    // A zero/negative/non-finite target would blow up the implied-upside
    // metric on every future evaluation of every screen.
    expect(() =>
      r.insertAnalystSnapshot({ ...analyst, medianTarget: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      r.insertAnalystSnapshot({ ...analyst, medianTarget: -5 }),
    ).toThrow(RangeError);
    expect(() =>
      r.insertAnalystSnapshot({ ...analyst, medianTarget: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      r.insertAnalystSnapshot({
        ticker: "ACME",
        asOf: "2026-07-10",
        medianTarget: 100,
        numAnalysts: 2.5,
      }),
    ).toThrow(RangeError);
    expect(() =>
      r.insertAnalystSnapshot({
        ticker: "ACME",
        asOf: "2026-7-10", // not zero-padded: would sort wrong forever
        medianTarget: 100,
        numAnalysts: 8,
      }),
    ).toThrow(RangeError);
    expect(() =>
      r.insertEarningsSnapshot({
        ticker: "ACME",
        asOf: "2026-07-10",
        nextEarningsDate: "2026-7-20",
      }),
    ).toThrow(RangeError);
    // Well-formed but impossible: reading it back through daysToEvent would
    // otherwise crash every screen evaluation, forever (append-only).
    expect(() =>
      r.insertEarningsSnapshot({
        ticker: "ACME",
        asOf: "2026-07-10",
        nextEarningsDate: "2026-02-30",
      }),
    ).toThrow(RangeError);
    expect(() =>
      r.insertDividendSnapshot({
        ticker: "ACME",
        asOf: "2026-7-10",
        nextExDivDate: null,
      }),
    ).toThrow(RangeError);
    expect(r.latestAnalystSnapshot("ACME")).toBeUndefined();
  });
});

describe("instruments — lifecycle bookkeeping", () => {
  it("addInstrument registers as pending; re-adding is a no-op", () => {
    const r = repo();
    r.addInstrument("ACME", "2026-07-10");
    r.setInstrumentState("ACME", "ready");
    r.addInstrument("ACME", "2026-07-12");
    expect(r.getInstrument("ACME")).toEqual({
      ticker: "ACME",
      currency: null,
      state: "ready",
      addedAt: "2026-07-10",
      lastPriceSync: null,
      lastMetadataSync: null,
      consecutiveFailures: 0,
    });
  });

  it("updates state, currency, and sync timestamps", () => {
    const r = repo();
    r.addInstrument("ACME", "2026-07-10");
    r.setInstrumentState("ACME", "backfilling");
    r.setInstrumentCurrency("ACME", "USD");
    r.recordPriceSync("ACME", "2026-07-11");
    r.recordMetadataSync("ACME", "2026-07-12");
    expect(r.getInstrument("ACME")).toEqual({
      ticker: "ACME",
      currency: "USD",
      state: "backfilling",
      addedAt: "2026-07-10",
      lastPriceSync: "2026-07-11",
      lastMetadataSync: "2026-07-12",
      consecutiveFailures: 0,
    });
  });

  it("rejects an invalid lifecycle state at the schema level", () => {
    const r = repo();
    r.addInstrument("ACME", "2026-07-10");
    expect(() => r.setInstrumentState("ACME", "exploded" as never)).toThrow();
  });

  it("updating an unknown instrument fails loudly", () => {
    const r = repo();
    expect(() => r.setInstrumentState("GHOST", "ready")).toThrow(
      /Unknown instrument: GHOST/,
    );
    expect(() => r.recordPriceSync("GHOST", "2026-07-10")).toThrow(
      /Unknown instrument/,
    );
  });

  it("tracks the consecutive-failure streak: increment returns the count, success resets", () => {
    const r = repo();
    r.addInstrument("ACME", "2026-07-10");
    expect(r.incrementFailures("ACME")).toBe(1);
    expect(r.incrementFailures("ACME")).toBe(2);
    expect(r.getInstrument("ACME")?.consecutiveFailures).toBe(2);
    r.resetFailures("ACME");
    expect(r.getInstrument("ACME")?.consecutiveFailures).toBe(0);
    expect(() => r.incrementFailures("GHOST")).toThrow(/Unknown instrument/);
    expect(() => r.resetFailures("GHOST")).toThrow(/Unknown instrument/);
  });

  it("lists instruments, optionally filtered by state", () => {
    const r = repo();
    r.addInstrument("AAA", "2026-07-10");
    r.addInstrument("BBB", "2026-07-10");
    r.setInstrumentState("BBB", "ready");
    expect(r.listInstruments().map((i) => i.ticker)).toEqual(["AAA", "BBB"]);
    expect(r.listInstruments("ready").map((i) => i.ticker)).toEqual(["BBB"]);
    expect(r.listInstruments("error")).toEqual([]);
  });
});
