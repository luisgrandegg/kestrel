import { resolveConfig } from "@kestrel/core/config";
import { makeCategory1Screen } from "@kestrel/core/screens/category1";
import type { InstrumentSnapshot } from "@kestrel/core/screens/screen";
import { Repository } from "@kestrel/core/storage/repository";
import { instrumentSnapshot } from "@kestrel/core/test-support/instrumentSnapshot";
import type { DailyClose, IsoDate } from "@kestrel/core/types";
import { ProviderRegistry } from "@kestrel/ingest/providers/registry";
import { providerWith } from "@kestrel/ingest/test-support/fakeProvider";
import { describe, expect, it } from "vitest";
import { evaluateScreens } from "./evaluateScreens.js";

const ASOF = "2026-07-31";

/** The pinned §5.2 fixture: exactly 4 completed ±10% fluctuations. */
const VOLATILE = [100, 112, 98, 113, 99, 114];
/**
 * A steady one-direction drift with no ≥10% reversal: 0 completed
 * fluctuations. Deliberately ends at the SAME close as VOLATILE so the
 * two fixtures differ only in volatility, never in BASE.
 */
const STEADY = [100, 104, 108, 111, 113, 114];
/**
 * Both fixtures end at close 114; 142.5/114 = exactly 25% implied upside
 * (all values dyadic, so the ratio is exact in floating point) — above
 * the default 20% threshold, below a 40% override.
 */
const TARGET = 142.5;

const toCloses = (ticker: string, prices: readonly number[]): DailyClose[] =>
  prices.map((close, i) => ({
    ticker,
    date: `2026-07-${String(i + 1).padStart(2, "0")}` as IsoDate,
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
  return instrumentSnapshot({
    asOf: ASOF,
    latestClose,
    analyst: { ticker: "ACME", asOf: ASOF, medianTarget, numAnalysts },
    closes,
  });
};

describe("category 1 — volatile + undervalued (MVP.md §6 row 1)", () => {
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
    // STEADY passes BASE (25% upside, 8 analysts) and is rejected ONLY by
    // the fluctuation gate — 0 completed swings.
    expect(screen.evaluate(snapshot(STEADY, TARGET))).toBeNull();
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

  it("counts only the trailing lookbackTradingDays rows of the closes it is handed", () => {
    // Lookback 2 keeps only [99, 114] of VOLATILE: a single unconfirmed
    // leg, 0 completed — the screen enforces its own window rather than
    // trusting the caller's slice.
    const screen = makeCategory1Screen(
      resolveConfig({ fluctuation: { lookbackTradingDays: 2 } }),
    );
    expect(screen.evaluate(snapshot(VOLATILE, TARGET))).toBeNull();
  });
});

describe("category 1 — end-to-end through the harness (backlog 015)", () => {
  const seed = async (
    repo: Repository,
    ticker: string,
    prices: readonly number[],
    medianTarget = TARGET,
  ) => {
    await repo.addInstrument(ticker, "2026-01-01");
    await repo.insertCloses(toCloses(ticker, prices));
    await repo.insertAnalystSnapshot({
      ticker,
      asOf: ASOF,
      medianTarget,
      numAnalysts: 8,
    });
    await repo.setInstrumentState(ticker, "ready");
  };

  it("returns exactly the right matches: cases straddling the upside threshold and the occurrence count", async () => {
    const repo = new Repository(":memory:");
    await seed(repo, "SWING", VOLATILE); // both gates pass: the only match
    await seed(repo, "CALM", STEADY); // BASE passes; fails ONLY the occurrence count
    await seed(repo, "PRICEY", VOLATILE, 118); // volatile enough; fails ONLY the upside gate
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);
    const config = resolveConfig();

    const [result] = await evaluateScreens(
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

  it.each([
    { served: ["analystTargets"] as const, missing: ["closes"] },
    { served: ["closes"] as const, missing: ["analystTargets"] },
  ])("disables with the missing capability named when only $served is served", async ({
    served,
    missing,
  }) => {
    const repo = new Repository(":memory:");
    await seed(repo, "SWING", VOLATILE);
    const registry = new ProviderRegistry([providerWith(...served)]);
    const config = resolveConfig();

    const [result] = await evaluateScreens(
      repo,
      registry,
      config,
      [makeCategory1Screen(config)],
      ASOF,
    );
    expect(result?.resolution).toEqual({ enabled: false, missing });
    expect(result?.matches).toEqual([]);
  });
});
