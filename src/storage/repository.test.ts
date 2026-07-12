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

  it("rejects non-positive closes at the schema level (DailyClose contract)", () => {
    const r = repo();
    expect(() =>
      r.insertCloses([{ ticker: "ACME", date: "2026-07-10", close: 0 }]),
    ).toThrow();
    expect(() =>
      r.insertCloses([{ ticker: "ACME", date: "2026-07-10", close: -5 }]),
    ).toThrow();
    // The failed batch rolled back atomically.
    expect(r.getCloses("ACME")).toHaveLength(0);
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

  it("latestAnalystSnapshot returns max(as_of) while prior rows stay readable via history", () => {
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
    // Inserting an older as_of later never displaces the latest.
    r.insertAnalystSnapshot({
      ticker: "ACME",
      asOf: "2026-06-15",
      medianTarget: 90,
      numAnalysts: 5,
    });
    expect(r.latestAnalystSnapshot("ACME")?.asOf).toBe("2026-07-10");
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
