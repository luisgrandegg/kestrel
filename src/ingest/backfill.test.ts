import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config/index.js";
import type { Provider } from "../providers/provider.js";
import { ProviderRegistry } from "../providers/registry.js";
import { Repository } from "../storage/repository.js";
import type { Capability, DailyClose, IsoDate } from "../types/index.js";
import { type BackfillDeps, runBackfill } from "./backfill.js";
import { addDays } from "./dates.js";
import { makeThrottle } from "./throttle.js";

const TODAY: IsoDate = "2026-07-10";
const ALL_CAPABILITIES: Capability[] = [
  "closes",
  "analystTargets",
  "earningsCalendar",
  "dividendCalendar",
];

interface FakeOptions {
  /** Capabilities the fake advertises (default: all four). */
  capabilities?: Capability[];
  /** Cap on closes returned per getCloses call (oldest first). */
  cap?: number;
  /** Tickers whose price fetch should throw (mutable between runs). */
  failing?: Set<string>;
  /** Tickers whose analyst fetch should throw (mutable between runs). */
  metadataFailing?: Set<string>;
  /** Ignore `from`: always return the same fixed 40-day slice of the
   * window, with close values that differ per call. */
  fixedSlice?: boolean;
  /** Return closes echoing a wrong (lowercased) ticker. */
  wrongTicker?: boolean;
  /** Include one close dated after the requested `to`. */
  futureDated?: boolean;
}

/** Fake provider serving synthetic calendar-daily closes. */
const makeFake = (options: FakeOptions = {}) => {
  const calls: string[] = [];
  let closesCalls = 0;
  const capabilities = options.capabilities ?? ALL_CAPABILITIES;
  const provider: Provider = {
    id: "fake",
    capabilities: new Set(capabilities),
  };
  if (capabilities.includes("closes")) {
    provider.getCloses = (ticker, from, to) => {
      calls.push(`closes:${ticker}:${from}:${to}`);
      closesCalls += 1;
      if (options.failing?.has(ticker)) {
        return Promise.reject(new Error(`provider down for ${ticker}`));
      }
      if (options.fixedSlice === true) {
        const start = addDays(TODAY, -365);
        return Promise.resolve(
          Array.from({ length: 40 }, (_, i) => ({
            ticker,
            date: addDays(start, i),
            close: 100 + closesCalls,
          })),
        );
      }
      const all: DailyClose[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        all.push({
          ticker: options.wrongTicker === true ? ticker.toLowerCase() : ticker,
          date: d,
          close: 100,
        });
      }
      if (options.futureDated === true) {
        all.push({ ticker, date: addDays(to, 5), close: 100 });
      }
      return Promise.resolve(
        options.cap === undefined ? all : all.slice(0, options.cap),
      );
    };
  }
  if (capabilities.includes("analystTargets")) {
    provider.getAnalystTargets = (ticker) => {
      calls.push(`analyst:${ticker}`);
      if (options.metadataFailing?.has(ticker)) {
        return Promise.reject(new Error(`analyst endpoint down for ${ticker}`));
      }
      return Promise.resolve({
        ticker,
        asOf: TODAY,
        medianTarget: 120,
        numAnalysts: 8,
      });
    };
  }
  if (capabilities.includes("earningsCalendar")) {
    provider.getNextEarnings = (ticker) => {
      calls.push(`earnings:${ticker}`);
      return Promise.resolve({
        ticker,
        asOf: TODAY,
        nextEarningsDate: "2026-07-20",
      });
    };
  }
  if (capabilities.includes("dividendCalendar")) {
    provider.getNextExDividend = (ticker) => {
      calls.push(`dividend:${ticker}`);
      return Promise.resolve({
        ticker,
        asOf: TODAY,
        nextExDivDate: "2026-07-15",
      });
    };
  }
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
    expect(report.skippedErrored).toEqual([]);

    const instrument = deps.repo.getInstrument("ACME");
    expect(instrument?.state).toBe("ready");
    expect(instrument?.lastPriceSync).toBe(TODAY);
    expect(instrument?.lastMetadataSync).toBe(TODAY);
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

  it("a shared pre-warmed throttle delays even the first backfill call (013 composition)", async () => {
    const { provider } = makeFake();
    const deps = makeDeps(provider);
    const shared = makeThrottle(
      deps.sleep,
      deps.config.ingestion.interCallDelayMs,
    );
    // Simulate a prior phase's provider call through the same throttle.
    await shared(() => Promise.resolve());
    expect(deps.sleeps).toHaveLength(0);
    await runBackfill({ ...deps, throttle: shared }, ["ACME"]);
    // 4 backfill calls, each preceded by a sleep because the throttle was warm.
    expect(deps.sleeps).toHaveLength(4);
  });

  it("re-running over a ready instrument adds nothing and calls no provider", async () => {
    const { provider, calls } = makeFake();
    const deps = makeDeps(provider);
    await runBackfill(deps, ["ACME"]);
    const closesAfterFirst = deps.repo.getCloses("ACME");
    const callsAfterFirst = calls.length;

    const report = await runBackfill(deps, ["ACME"]);
    expect(report.processed).toEqual([]);
    expect(calls).toHaveLength(callsAfterFirst);
    expect(deps.repo.getCloses("ACME")).toEqual(closesAfterFirst);
  });

  it("overlapping re-fetches are idempotent: original values kept, no duplicates", async () => {
    // The fake ignores `from` and returns the same 40 dates with DIFFERENT
    // values per call — two runs while still backfilling must keep run 1's
    // values (insert-or-ignore, never overwrite).
    const { provider } = makeFake({ fixedSlice: true });
    const deps = makeDeps(provider);

    await runBackfill(deps, ["ACME"]);
    const afterFirst = deps.repo.getCloses("ACME");
    expect(afterFirst).toHaveLength(40);
    expect(deps.repo.getInstrument("ACME")?.state).toBe("backfilling");

    const report = await runBackfill(deps, ["ACME"]);
    expect(report.processed).toEqual(["ACME"]);
    expect(deps.repo.getCloses("ACME")).toEqual(afterFirst);
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

  it("a crash after closes landed but before metadata completed resumes cleanly", async () => {
    const metadataFailing = new Set(["ACME"]);
    const { provider } = makeFake({ metadataFailing });
    const deps = makeDeps(provider);

    // Run 1: closes persist, then the analyst fetch dies mid-instrument.
    const report = await runBackfill(deps, ["ACME"]);
    expect(report.failures).toEqual([
      { ticker: "ACME", message: "analyst endpoint down for ACME" },
    ]);
    const closesAfterCrash = deps.repo.getCloses("ACME");
    expect(closesAfterCrash.length).toBeGreaterThan(0);
    const instrument = deps.repo.getInstrument("ACME");
    expect(instrument?.lastMetadataSync).toBeNull();
    expect(instrument?.consecutiveFailures).toBe(1);
    expect(instrument?.state).toBe("backfilling");
    expect(deps.repo.latestAnalystSnapshot("ACME")).toBeUndefined();

    // Run 2 with the endpoint recovered: metadata completes, closes are not
    // duplicated, the instrument promotes.
    metadataFailing.delete("ACME");
    await runBackfill(deps, ["ACME"]);
    expect(deps.repo.getCloses("ACME")).toEqual(closesAfterCrash);
    const recovered = deps.repo.getInstrument("ACME");
    expect(recovered?.lastMetadataSync).toBe(TODAY);
    expect(recovered?.consecutiveFailures).toBe(0);
    expect(recovered?.state).toBe("ready");
    expect(deps.repo.latestAnalystSnapshot("ACME")?.medianTarget).toBe(120);
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
  it("marks an instrument error at the persisted threshold across runs, then skips and reports it", async () => {
    const { provider, calls } = makeFake({ failing: new Set(["BAD"]) });
    const deps = makeDeps(provider);

    await runBackfill(deps, ["BAD"]);
    await runBackfill(deps, ["BAD"]);
    expect(deps.repo.getInstrument("BAD")?.state).toBe("backfilling");

    const report = await runBackfill(deps, ["BAD"]);
    expect(report.errored).toEqual(["BAD"]);
    expect(deps.repo.getInstrument("BAD")?.state).toBe("error");

    // A further run leaves the error instrument alone — but reports it, so
    // a dead watchlist is never indistinguishable from "nothing to do".
    const callCount = calls.length;
    const quiet = await runBackfill(deps, ["BAD"]);
    expect(quiet.processed).toEqual([]);
    expect(quiet.skippedErrored).toEqual(["BAD"]);
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

describe("runBackfill — provider data validation (append-only defense)", () => {
  it("rejects closes echoing the wrong ticker, charging the provider's streak", async () => {
    const { provider } = makeFake({ wrongTicker: true });
    const deps = makeDeps(provider);
    const report = await runBackfill(deps, ["ACME"]);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.message).toMatch(/"acme" when "ACME"/);
    expect(deps.repo.getCloses("ACME")).toHaveLength(0);
    expect(deps.repo.getInstrument("ACME")?.consecutiveFailures).toBe(1);
  });

  it("rejects future-dated closes before they can poison the resume cursor", async () => {
    const { provider } = makeFake({ futureDated: true });
    const deps = makeDeps(provider);
    const report = await runBackfill(deps, ["ACME"]);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.message).toMatch(/future-dated close/);
    expect(deps.repo.getCloses("ACME")).toHaveLength(0);
  });
});

describe("runBackfill — capability handling", () => {
  it("throws loudly when no provider serves closes", async () => {
    const { provider } = makeFake({ capabilities: ["analystTargets"] });
    const deps = makeDeps(provider);
    await expect(runBackfill(deps, ["ACME"])).rejects.toThrow(
      /no active provider serves the "closes" capability/,
    );
  });

  it("skips unserved metadata capabilities without failing or fabricating", async () => {
    const { provider } = makeFake({ capabilities: ["closes"] });
    const deps = makeDeps(provider);
    const report = await runBackfill(deps, ["ACME"]);
    expect(report.processed).toEqual(["ACME"]);
    expect(deps.repo.latestAnalystSnapshot("ACME")).toBeUndefined();
    expect(deps.repo.getInstrument("ACME")?.lastMetadataSync).toBe(TODAY);
  });
});
