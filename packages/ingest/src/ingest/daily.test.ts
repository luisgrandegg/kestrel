import { resolveConfig } from "@kestrel/core/config";
import type { StorageRepository } from "@kestrel/core/storage/port";
import { Repository } from "@kestrel/core/storage/repository";
import type { Capability, DailyClose, IsoDate } from "@kestrel/core/types";
import { describe, expect, it } from "vitest";
import type { Provider } from "../providers/provider.js";
import { ProviderRegistry } from "../providers/registry.js";
import type { BackfillDeps } from "./backfill.js";
import { runDaily } from "./daily.js";
import { addDays } from "./dates.js";

const TODAY: IsoDate = "2026-07-10";

interface FakeOptions {
  /** Tickers whose price fetch should throw (mutable between runs). */
  failing?: Set<string>;
  /** Tickers whose analyst fetch should throw. */
  metadataFailing?: Set<string>;
  /** Return an empty array from getCloses (weekend/holiday window). */
  emptyCloses?: boolean;
  /** Tickers whose getInstrumentInfo (currency) fetch should throw. */
  currencyFailing?: Set<string>;
}

const makeFake = (options: FakeOptions = {}) => {
  const calls: string[] = [];
  let target = 120;
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
      if (options.emptyCloses === true) {
        return Promise.resolve([]);
      }
      const all: DailyClose[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        all.push({ ticker, date: d, close: 100 });
      }
      return Promise.resolve(all);
    },
    // Required alongside getCloses by the `closes` capability (ADR-0012).
    getInstrumentInfo: (ticker) => {
      calls.push(`currency:${ticker}`);
      if (options.currencyFailing?.has(ticker)) {
        return Promise.reject(
          new Error(`currency endpoint down for ${ticker}`),
        );
      }
      return Promise.resolve({ ticker, currency: "USD" });
    },
    getAnalystTargets: (ticker) => {
      calls.push(`analyst:${ticker}`);
      if (options.metadataFailing?.has(ticker)) {
        return Promise.reject(new Error(`analyst endpoint down for ${ticker}`));
      }
      target += 1;
      return Promise.resolve({
        ticker,
        asOf: TODAY,
        medianTarget: target,
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

/**
 * A ready instrument with history through `lastDate` and fresh metadata.
 * Currency defaults to already-known ("USD") so the daily currency copy is a
 * no-op — tests exercising the copy pass `currency: null` explicitly.
 */
const seedReady = async (
  repo: StorageRepository,
  ticker: string,
  lastDate: IsoDate,
  metadataSyncedOn: IsoDate,
  currency: string | null = "USD",
): Promise<void> => {
  await repo.addInstrument(ticker, "2026-01-01");
  const closes: DailyClose[] = [];
  for (let i = 99; i >= 0; i--) {
    closes.push({ ticker, date: addDays(lastDate, -i), close: 100 });
  }
  await repo.insertCloses(closes);
  await repo.insertAnalystSnapshot({
    ticker,
    asOf: metadataSyncedOn,
    medianTarget: 110,
    numAnalysts: 7,
  });
  await repo.recordMetadataSync(ticker, metadataSyncedOn);
  await repo.recordPriceSync(ticker, lastDate);
  if (currency !== null) {
    await repo.setInstrumentCurrency(ticker, currency);
  }
  await repo.setInstrumentState(ticker, "ready");
};

describe("runDaily — incremental refresh (MVP §7 step 1)", () => {
  it("fetches only the missing recent days for a ready instrument", async () => {
    const { provider, calls } = makeFake();
    const deps = makeDeps(provider);
    await seedReady(deps.repo, "ACME", addDays(TODAY, -3), TODAY);

    const report = await runDaily(deps, ["ACME"]);
    expect(report.refreshed).toEqual(["ACME"]);
    expect(report.metadataRefreshed).toEqual([]);
    // Exactly one provider call: the incremental window, cursor = latest+1.
    expect(calls).toEqual([`closes:ACME:${addDays(TODAY, -2)}:${TODAY}`]);
    expect((await deps.repo.latestClose("ACME"))?.date).toBe(TODAY);
    expect((await deps.repo.getInstrument("ACME"))?.lastPriceSync).toBe(TODAY);
  });

  it("a same-day second run makes no provider calls (dedupe by lastPriceSync)", async () => {
    const { provider, calls } = makeFake();
    const deps = makeDeps(provider);
    // Prices only current through yesterday (e.g. weekend: today's close
    // does not exist), but a successful run already stamped today.
    await seedReady(deps.repo, "ACME", addDays(TODAY, -1), TODAY);
    await deps.repo.recordPriceSync("ACME", TODAY);

    const report = await runDaily(deps, ["ACME"]);
    expect(report.refreshed).toEqual(["ACME"]);
    expect(calls).toEqual([]);
  });

  it("weekend/holiday windows are harmless no-ops", async () => {
    const { provider } = makeFake({ emptyCloses: true });
    const deps = makeDeps(provider);
    await seedReady(deps.repo, "ACME", addDays(TODAY, -2), TODAY);

    const before = await deps.repo.getCloses("ACME");
    const report = await runDaily(deps, ["ACME"]);
    expect(report.refreshed).toEqual(["ACME"]);
    expect(report.failures).toEqual([]);
    expect(await deps.repo.getCloses("ACME")).toEqual(before);
  });
});

describe("runDaily — metadata TTL (MVP §7 step 1)", () => {
  it("leaves metadata untouched inside the TTL", async () => {
    const { provider } = makeFake();
    const deps = makeDeps(provider);
    // Synced yesterday; TTL is 7 days.
    await seedReady(deps.repo, "ACME", addDays(TODAY, -1), addDays(TODAY, -1));

    const report = await runDaily(deps, ["ACME"]);
    expect(report.metadataRefreshed).toEqual([]);
    expect((await deps.repo.latestAnalystSnapshot("ACME"))?.medianTarget).toBe(
      110,
    );
  });

  it("refreshes metadata as a NEW snapshot row once the TTL elapses", async () => {
    const { provider } = makeFake();
    const deps = makeDeps(provider);
    const syncedLongAgo = addDays(
      TODAY,
      -deps.config.ingestion.metadataTtlDays,
    );
    await seedReady(deps.repo, "ACME", addDays(TODAY, -1), syncedLongAgo);

    const report = await runDaily(deps, ["ACME"]);
    expect(report.metadataRefreshed).toEqual(["ACME"]);
    // New snapshot appended; the old one remains readable as-of its date.
    expect((await deps.repo.latestAnalystSnapshot("ACME"))?.medianTarget).toBe(
      121,
    );
    expect(
      (await deps.repo.latestAnalystSnapshot("ACME", syncedLongAgo))
        ?.medianTarget,
    ).toBe(110);
    expect((await deps.repo.getInstrument("ACME"))?.lastMetadataSync).toBe(
      TODAY,
    );
  });
});

describe("runDaily — instrument currency (ADR-0012 decision 3)", () => {
  it("copies currency for a ready instrument whose currency is still null", async () => {
    const { provider, calls } = makeFake();
    const deps = makeDeps(provider);
    // Ready but never captured currency (e.g. promoted before the surface).
    await seedReady(deps.repo, "ACME", addDays(TODAY, -3), TODAY, null);
    expect((await deps.repo.getInstrument("ACME"))?.currency).toBeNull();

    const report = await runDaily(deps, ["ACME"]);
    expect(report.refreshed).toEqual(["ACME"]);
    expect((await deps.repo.getInstrument("ACME"))?.currency).toBe("USD");
    expect(calls.filter((c) => c.startsWith("currency:"))).toEqual([
      "currency:ACME",
    ]);
  });

  it("does not refetch currency once known", async () => {
    const { provider, calls } = makeFake();
    const deps = makeDeps(provider);
    await seedReady(deps.repo, "ACME", addDays(TODAY, -3), TODAY, "EUR");

    await runDaily(deps, ["ACME"]);
    expect(calls.filter((c) => c.startsWith("currency:"))).toEqual([]);
    // The already-known currency is untouched (never overwritten).
    expect((await deps.repo.getInstrument("ACME"))?.currency).toBe("EUR");
  });

  it("charges a currency-fetch failure as a provider failure", async () => {
    const currencyFailing = new Set(["ACME"]);
    const { provider } = makeFake({ currencyFailing });
    const deps = makeDeps(provider);
    await seedReady(deps.repo, "ACME", addDays(TODAY, -3), TODAY, null);

    const report = await runDaily(deps, ["ACME"]);
    expect(report.failures).toEqual([
      { ticker: "ACME", message: "currency endpoint down for ACME" },
    ]);
    // Prices landed and ARE reported refreshed — a non-price currency failure
    // must not un-report a healthy price refresh (it still charges the streak
    // and skips resetFailures, so the failure is not lost).
    expect(report.refreshed).toEqual(["ACME"]);
    expect((await deps.repo.getInstrument("ACME"))?.currency).toBeNull();
    expect((await deps.repo.getInstrument("ACME"))?.consecutiveFailures).toBe(
      1,
    );
  });
});

describe("runDaily — one throttled run across both phases (MVP §7 step 3)", () => {
  it("shares a single throttle: the backfill phase's first call also sleeps", async () => {
    const { provider, calls } = makeFake();
    const deps = makeDeps(provider);
    // One ready instrument with known currency (1 price call) + one brand-new
    // instrument (1 price + 1 currency + 3 metadata calls) in the same run.
    await seedReady(deps.repo, "OLD", addDays(TODAY, -3), TODAY);

    const report = await runDaily(deps, ["OLD", "NEW"]);
    expect(report.refreshed).toEqual(["OLD"]);
    expect(report.backfill.promoted).toEqual(["NEW"]);
    expect(calls).toHaveLength(6);
    // 6 calls, one throttle: 5 sleeps — including the phase boundary.
    expect(deps.sleeps).toHaveLength(5);
    expect(new Set(deps.sleeps)).toEqual(
      new Set([deps.config.ingestion.interCallDelayMs]),
    );
  });
});

describe("runDaily — failure accounting on ready instruments", () => {
  it("demotes a ready instrument to sticky error at the persisted threshold", async () => {
    const failing = new Set(["ACME"]);
    const { provider } = makeFake({ failing });
    const deps = makeDeps(provider);
    await seedReady(deps.repo, "ACME", addDays(TODAY, -3), TODAY);

    await runDaily(deps, ["ACME"]);
    await runDaily(deps, ["ACME"]);
    expect((await deps.repo.getInstrument("ACME"))?.state).toBe("ready");

    const report = await runDaily(deps, ["ACME"]);
    expect(report.errored).toEqual(["ACME"]);
    expect((await deps.repo.getInstrument("ACME"))?.state).toBe("error");

    const quiet = await runDaily(deps, ["ACME"]);
    expect(quiet.refreshed).toEqual([]);
    expect(quiet.skippedErrored).toEqual(["ACME"]);
  });

  it("a demotion run reports the ticker in errored, not skippedErrored", async () => {
    const failing = new Set(["ACME"]);
    const { provider } = makeFake({ failing });
    const deps = makeDeps(provider);
    await seedReady(deps.repo, "ACME", addDays(TODAY, -3), TODAY);

    await runDaily(deps, ["ACME"]);
    await runDaily(deps, ["ACME"]);
    const demotionRun = await runDaily(deps, ["ACME"]);
    expect(demotionRun.errored).toEqual(["ACME"]);
    expect(demotionRun.skippedErrored).toEqual([]);
  });

  it("a metadata failure still reports prices as refreshed, and repeated ones demote", async () => {
    const metadataFailing = new Set(["ACME"]);
    const { provider } = makeFake({ metadataFailing });
    const deps = makeDeps(provider);
    const syncedLongAgo = addDays(
      TODAY,
      -deps.config.ingestion.metadataTtlDays,
    );
    await seedReady(deps.repo, "ACME", addDays(TODAY, -3), syncedLongAgo);

    const report = await runDaily(deps, ["ACME"]);
    // Prices WERE stored: the report must say so, alongside the failure.
    expect(report.refreshed).toEqual(["ACME"]);
    expect(report.failures).toEqual([
      { ticker: "ACME", message: "analyst endpoint down for ACME" },
    ]);
    expect((await deps.repo.latestClose("ACME"))?.date).toBe(TODAY);
    // The streak accumulates (no reset-after-prices), so a permanently
    // broken metadata endpoint eventually demotes per MVP §7.
    expect((await deps.repo.getInstrument("ACME"))?.consecutiveFailures).toBe(
      1,
    );
  });

  it("fails loudly when a ready instrument has no stored history (invariant)", async () => {
    const { provider, calls } = makeFake();
    const deps = makeDeps(provider);
    await deps.repo.addInstrument("GHOST", "2026-01-01");
    await deps.repo.setInstrumentState("GHOST", "ready");

    await expect(runDaily(deps, ["GHOST"])).rejects.toThrow(
      /Invariant violated: ready instrument GHOST has no stored close/,
    );
    expect(calls).toEqual([]);
  });

  it("a successful refresh resets the streak", async () => {
    const failing = new Set(["ACME"]);
    const { provider } = makeFake({ failing });
    const deps = makeDeps(provider);
    await seedReady(deps.repo, "ACME", addDays(TODAY, -3), TODAY);

    await runDaily(deps, ["ACME"]);
    expect((await deps.repo.getInstrument("ACME"))?.consecutiveFailures).toBe(
      1,
    );
    failing.delete("ACME");
    await runDaily(deps, ["ACME"]);
    expect((await deps.repo.getInstrument("ACME"))?.consecutiveFailures).toBe(
      0,
    );
  });
});
