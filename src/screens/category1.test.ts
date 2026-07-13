import { describe, expect, it } from "vitest";
import { evaluateScreens } from "../app/evaluateScreens.js";
import { resolveConfig } from "../config/index.js";
import type { Provider } from "../providers/provider.js";
import { ProviderRegistry } from "../providers/registry.js";
import { Repository } from "../storage/repository.js";
import type { Capability, DailyClose, IsoDate } from "../types/index.js";
import { makeCategory1Screen } from "./category1.js";
import type { InstrumentSnapshot } from "./screen.js";

const ASOF = "2026-07-10";

/** The pinned §5.2 fixture: exactly 4 completed ±10% fluctuations. */
const VOLATILE = [100, 112, 98, 113, 99, 114];
/** A steady one-direction ramp: 0 completed fluctuations. */
const MONOTONIC = [100, 113, 128, 145, 164, 186];

const toCloses = (ticker: string, prices: readonly number[]): DailyClose[] =>
  prices.map((close, i) => ({
    ticker,
    date: `2026-07-0${i + 1}` as IsoDate,
    close,
  }));

const snapshot = (
  prices: readonly number[],
  medianTarget: number,
  numAnalysts = 8,
): InstrumentSnapshot => {
  const closes = toCloses("ACME", prices);
  const latestClose = closes[closes.length - 1];
  if (latestClose === undefined) {
    throw new Error("fixture needs at least one close");
  }
  return {
    ticker: "ACME",
    currency: "USD",
    asOf: ASOF,
    latestClose,
    analyst: { ticker: "ACME", asOf: ASOF, medianTarget, numAnalysts },
    earnings: null,
    dividend: null,
    closes,
  };
};

describe("category 1 — volatile + undervalued (MVP.md §6 row 1)", () => {
  // Both fixtures end at close 114; 142.5/114 = exactly 25% upside.
  const TARGET = 142.5;

  it("matches BASE AND completedFluctuations >= minOccurrences, carrying the §8 row numbers", () => {
    const screen = makeCategory1Screen(resolveConfig());
    expect(screen.requiredCapabilities).toEqual(["closes", "analystTargets"]);
    // 4 completed fluctuations = the default minOccurrences exactly (>= boundary).
    expect(screen.evaluate(snapshot(VOLATILE, TARGET))).toEqual({
      ticker: "ACME",
      currency: "USD",
      impliedUpside: 0.25,
      medianTarget: TARGET,
      latestClose: 114,
      numAnalysts: 8,
      completedFluctuations: 4,
    });
  });

  it("excludes an instrument passing BASE but with too few completed fluctuations", () => {
    const screen = makeCategory1Screen(resolveConfig());
    expect(screen.evaluate(snapshot(MONOTONIC, TARGET))).toBeNull();
  });

  it("excludes an instrument with enough fluctuations but failing BASE — upside or analyst gate", () => {
    const screen = makeCategory1Screen(resolveConfig());
    // 118/114 ≈ 3.5% upside: below the default 20% threshold.
    expect(screen.evaluate(snapshot(VOLATILE, 118))).toBeNull();
    // Analyst count below the global gate.
    expect(screen.evaluate(snapshot(VOLATILE, TARGET, 2))).toBeNull();
    // No analyst snapshot at all: missing data, never a fabricated zero.
    expect(
      screen.evaluate({ ...snapshot(VOLATILE, TARGET), analyst: null }),
    ).toBeNull();
  });

  it("every threshold comes from config: raising minOccurrences or upsideThreshold excludes the same instrument", () => {
    const stricterCount = makeCategory1Screen(
      resolveConfig({ fluctuation: { minOccurrences: 5 } }),
    );
    expect(stricterCount.evaluate(snapshot(VOLATILE, TARGET))).toBeNull();

    const stricterUpside = makeCategory1Screen(
      resolveConfig({ screens: { category1: { upsideThreshold: 0.4 } } }),
    );
    expect(stricterUpside.evaluate(snapshot(VOLATILE, TARGET))).toBeNull();

    // A wider swing threshold confirms fewer legs: ±10% moves stop counting.
    const widerSwing = makeCategory1Screen(
      resolveConfig({ fluctuation: { swingPct: 0.2 } }),
    );
    expect(widerSwing.evaluate(snapshot(VOLATILE, TARGET))).toBeNull();
  });
});

describe("category 1 — end-to-end through the harness (backlog 015)", () => {
  const providerWith = (...capabilities: Capability[]): Provider => ({
    id: "fake",
    capabilities: new Set(capabilities),
    getCloses: () => Promise.resolve([]),
    getAnalystTargets: () =>
      Promise.resolve({
        ticker: "X",
        asOf: ASOF,
        medianTarget: 1,
        numAnalysts: 5,
      }),
    getNextEarnings: () =>
      Promise.resolve({ ticker: "X", asOf: ASOF, nextEarningsDate: null }),
    getNextExDividend: () =>
      Promise.resolve({ ticker: "X", asOf: ASOF, nextExDivDate: null }),
  });

  const seed = (
    repo: Repository,
    ticker: string,
    prices: readonly number[],
  ) => {
    repo.addInstrument(ticker, "2026-01-01");
    repo.insertCloses(toCloses(ticker, prices));
    repo.insertAnalystSnapshot({
      ticker,
      asOf: ASOF,
      medianTarget: 142.5,
      numAnalysts: 8,
    });
    repo.setInstrumentState(ticker, "ready");
  };

  it("returns exactly the volatile+undervalued instruments from stored data", () => {
    const repo = new Repository(":memory:");
    seed(repo, "SWING", VOLATILE); // qualifies
    seed(repo, "STEADY", MONOTONIC); // BASE passes, 0 fluctuations
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);
    const config = resolveConfig();

    const [result] = evaluateScreens(
      repo,
      registry,
      config,
      [makeCategory1Screen(config)],
      ASOF,
    );
    expect(result?.resolution).toEqual({ enabled: true });
    expect(result?.matches.map((m) => m.ticker)).toEqual(["SWING"]);
    expect(result?.matches[0]?.completedFluctuations).toBe(4);
  });

  it("disables with the missing capability named when analystTargets is unserved", () => {
    const repo = new Repository(":memory:");
    seed(repo, "SWING", VOLATILE);
    const registry = new ProviderRegistry([providerWith("closes")]);
    const config = resolveConfig();

    const [result] = evaluateScreens(
      repo,
      registry,
      config,
      [makeCategory1Screen(config)],
      ASOF,
    );
    expect(result?.resolution).toEqual({
      enabled: false,
      missing: ["analystTargets"],
    });
    expect(result?.matches).toEqual([]);
  });
});
