import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config/index.js";
import type { Provider } from "../providers/provider.js";
import { ProviderRegistry } from "../providers/registry.js";
import { Repository } from "../storage/repository.js";
import type { Capability, DailyClose, IsoDate } from "../types/index.js";
import { type BackfillDeps, runBackfill } from "./backfill.js";
import { addDays } from "./dates.js";

const TODAY: IsoDate = "2026-07-10";

/** Generate consecutive daily closes ending at `end` (calendar days). */
const series = (ticker: string, end: IsoDate, count: number): DailyClose[] =>
  Array.from({ length: count }, (_, i) => ({
    ticker,
    date: addDays(end, -(count - 1 - i)),
    close: 100 + i,
  }));

interface FakeOptions {
  /** Cap on closes returned per getCloses call (oldest first). */
  cap?: number;
  /** Tickers whose price fetch should throw. */
  failing?: Set<string>;
}

/** Full-capability fake provider serving one year of synthetic closes. */
const makeFake = (options: FakeOptions = {}) => {
  const calls: string[] = [];
  const provider: Provider = {
    id: "fake",
    capabilities: new Set<Capability>([
      "closes",
      "analystTargets",
      "earningsCalendar",
      "dividendCalendar",
    ]),
    getCloses: (ticker, from, to) => {
      calls.push(`closes:${ticker}:${from}:${to}`);
      if (options.failing?.has(ticker)) {
        return Promise.reject(new Error(`provider down for ${ticker}`));
      }
      // One synthetic close per calendar day in [from, to], oldest first.
      const all: DailyClose[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        all.push({ ticker, date: d, close: 100 });
      }
      return Promise.resolve(
        options.cap === undefined ? all : all.slice(0, options.cap),
      );
    },
    getAnalystTargets: (ticker) => {
      calls.push(`analyst:${ticker}`);
      return Promise.resolve({
        ticker,
        asOf: TODAY,
        medianTarget: 120,
        numAnalysts: 8,
      });
    },
    getNextEarnings: (ticker) => {
      calls.push(`earnings:${ticker}`);
      return Promise.resolve({
        ticker,
        asOf: TODAY,
        nextEarningsDate: "2026-07-20",
      });
    },
    getNextExDividend: (ticker) => {
      calls.push(`dividend:${ticker}`);
      return Promise.resolve({
        ticker,
        asOf: TODAY,
        nextExDivDate: "2026-07-15",
      });
    },
  };
  return { provider, calls };
};

const makeDeps = (provider: Provider): BackfillDeps & { sleeps: number[] } => {
  const sleeps: number[] = [];
  return {
    repo: new Repository(":memory:"),
    registry: new ProviderRegistry([provider]),
    config: resolveConfig(),
    today: TODAY,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    sleeps,
  };
};

describe("runBackfill — happy path", () => {
  it("registers, backfills, snapshots, and promotes a new instrument to ready", async () => {
    const { provider } = makeFake();
    const deps = makeDeps(provider);
    const report = await runBackfill(deps, ["ACME"]);

    expect(report.processed).toEqual(["ACME"]);
    expect(report.promoted).toEqual(["ACME"]);
    expect(report.failures).toEqual([]);

    const instrument = deps.repo.getInstrument("ACME");
    expect(instrument?.state).toBe("ready");
    expect(instrument?.lastPriceSync).toBe(TODAY);
    expect(instrument?.lastMetadataSync).toBe(TODAY);
    // 365 calendar days of synthetic closes + today = 366 rows.
    expect(deps.repo.getCloses("ACME").length).toBeGreaterThan(63);
    expect(deps.repo.latestAnalystSnapshot("ACME")?.medianTarget).toBe(120);
    expect(deps.repo.latestEarningsSnapshot("ACME")?.nextEarningsDate).toBe(
      "2026-07-20",
    );
    expect(deps.repo.latestDividendSnapshot("ACME")?.nextExDivDate).toBe(
      "2026-07-15",
    );
  });

  it("throttles every provider call after the first with interCallDelayMs", async () => {
    const { provider, calls } = makeFake();
    const deps = makeDeps(provider);
    await runBackfill(deps, ["AAA", "BBB"]);
    // 2 instruments × (1 closes + 3 metadata) = 8 calls, 7 sleeps between.
    expect(calls).toHaveLength(8);
    expect(deps.sleeps).toHaveLength(7);
    expect(new Set(deps.sleeps)).toEqual(
      new Set([deps.config.ingestion.interCallDelayMs]),
    );
  });

  it("is idempotent: a second run adds nothing and changes nothing", async () => {
    const { provider } = makeFake();
    const deps = makeDeps(provider);
    await runBackfill(deps, ["ACME"]);
    const closesAfterFirst = deps.repo.getCloses("ACME");

    const report = await runBackfill(deps, ["ACME"]);
    // Already ready: not a backfill target any more.
    expect(report.processed).toEqual([]);
    expect(deps.repo.getCloses("ACME")).toEqual(closesAfterFirst);
  });
});

describe("runBackfill — resumability (guardrail 7)", () => {
  it("a capped provider accumulates history across runs without duplication", async () => {
    const { provider } = makeFake({ cap: 40 });
    const deps = makeDeps(provider);

    await runBackfill(deps, ["ACME"]);
    expect(deps.repo.getInstrument("ACME")?.state).toBe("backfilling");
    expect(deps.repo.getCloses("ACME")).toHaveLength(40);

    await runBackfill(deps, ["ACME"]);
    expect(deps.repo.getCloses("ACME")).toHaveLength(80);
    expect(deps.repo.getInstrument("ACME")?.state).toBe("ready");

    // No duplicates: every (ticker, date) unique.
    const dates = deps.repo.getCloses("ACME").map((c) => c.date);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("resumes from the latest stored close, not the window start", async () => {
    const { provider, calls } = makeFake({ cap: 40 });
    const deps = makeDeps(provider);
    await runBackfill(deps, ["ACME"]);
    const firstFrom = calls[0];
    await runBackfill(deps, ["ACME"]);
    const secondFrom = calls.at(-1);
    expect(firstFrom).not.toEqual(secondFrom);
    const latestAfterFirst = addDays(
      addDays(TODAY, -deps.config.ingestion.backfillLookbackDays),
      39,
    );
    expect(secondFrom).toBe(
      `closes:ACME:${addDays(latestAfterFirst, 1)}:${TODAY}`,
    );
  });

  it("a failure on one instrument does not abort the rest of the run", async () => {
    const { provider } = makeFake({ failing: new Set(["BAD"]) });
    const deps = makeDeps(provider);
    const report = await runBackfill(deps, ["BAD", "GOOD"]);
    expect(report.processed).toEqual(["GOOD"]);
    expect(report.failures).toEqual([
      { ticker: "BAD", message: "provider down for BAD" },
    ]);
    expect(deps.repo.getInstrument("GOOD")?.state).toBe("ready");
    expect(deps.repo.getInstrument("BAD")?.consecutiveFailures).toBe(1);
  });
});

describe("runBackfill — failure accounting (MVP §7 error rule)", () => {
  it("marks an instrument error at the persisted threshold across runs, then skips it", async () => {
    const { provider, calls } = makeFake({ failing: new Set(["BAD"]) });
    const deps = makeDeps(provider);

    await runBackfill(deps, ["BAD"]);
    await runBackfill(deps, ["BAD"]);
    expect(deps.repo.getInstrument("BAD")?.state).toBe("backfilling");

    const report = await runBackfill(deps, ["BAD"]);
    expect(report.errored).toEqual(["BAD"]);
    expect(deps.repo.getInstrument("BAD")?.state).toBe("error");

    // A further run leaves the error instrument alone.
    const callCount = calls.length;
    const quiet = await runBackfill(deps, ["BAD"]);
    expect(quiet.processed).toEqual([]);
    expect(calls).toHaveLength(callCount);
  });

  it("a success resets the persisted failure streak", async () => {
    const failing = new Set(["FLAKY"]);
    const { provider } = makeFake({ failing });
    const deps = makeDeps(provider);

    await runBackfill(deps, ["FLAKY"]);
    await runBackfill(deps, ["FLAKY"]);
    expect(deps.repo.getInstrument("FLAKY")?.consecutiveFailures).toBe(2);

    failing.delete("FLAKY");
    await runBackfill(deps, ["FLAKY"]);
    expect(deps.repo.getInstrument("FLAKY")?.consecutiveFailures).toBe(0);
    expect(deps.repo.getInstrument("FLAKY")?.state).toBe("ready");
  });
});

describe("runBackfill — capability handling", () => {
  it("throws loudly when no provider serves closes", async () => {
    const pricesless: Provider = {
      id: "meta-only",
      capabilities: new Set<Capability>(["analystTargets"]),
      getAnalystTargets: (ticker) =>
        Promise.resolve({
          ticker,
          asOf: TODAY,
          medianTarget: 1,
          numAnalysts: 5,
        }),
    };
    const deps = {
      ...makeDeps(pricesless),
      registry: new ProviderRegistry([pricesless]),
    };
    await expect(runBackfill(deps, ["ACME"])).rejects.toThrow(
      /no active provider serves the "closes" capability/,
    );
  });

  it("skips unserved metadata capabilities without failing or fabricating", async () => {
    const pricesOnly: Provider = {
      id: "prices-only",
      capabilities: new Set<Capability>(["closes"]),
      getCloses: (ticker, from, to) =>
        Promise.resolve(series(ticker, to, 100).filter((c) => c.date >= from)),
    };
    const deps = {
      ...makeDeps(pricesOnly),
      registry: new ProviderRegistry([pricesOnly]),
    };
    const report = await runBackfill(deps, ["ACME"]);
    expect(report.processed).toEqual(["ACME"]);
    expect(deps.repo.latestAnalystSnapshot("ACME")).toBeUndefined();
    expect(deps.repo.getInstrument("ACME")?.lastMetadataSync).toBe(TODAY);
  });
});
