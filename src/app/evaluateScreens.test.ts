import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config/index.js";
import type { Provider } from "../providers/provider.js";
import { ProviderRegistry } from "../providers/registry.js";
import { type BaseMatch, evaluateBase } from "../screens/base.js";
import type { Screen } from "../screens/screen.js";
import { Repository } from "../storage/repository.js";
import type { Capability } from "../types/index.js";
import { evaluateScreens } from "./evaluateScreens.js";

const ASOF = "2026-07-10";

/** A minimal base-predicate screen for exercising the harness end-to-end. */
const baseScreen: Screen<BaseMatch> = {
  id: "base-only",
  requiredCapabilities: ["closes", "analystTargets"],
  evaluate: (snapshot, config) =>
    evaluateBase(
      snapshot,
      config.minAnalysts,
      config.screens.category1.upsideThreshold,
    ),
};

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
  close: number,
  medianTarget: number,
  numAnalysts: number,
): void => {
  repo.addInstrument(ticker, "2026-01-01");
  repo.insertCloses([{ ticker, date: ASOF, close }]);
  repo.insertAnalystSnapshot({ ticker, asOf: ASOF, medianTarget, numAnalysts });
  repo.setInstrumentState(ticker, "ready");
};

describe("evaluateScreens — harness over fixture storage (backlog 014)", () => {
  it("evaluates enabled screens over ready instruments and returns matches with supporting numbers", () => {
    const repo = new Repository(":memory:");
    seed(repo, "HIT", 100, 130, 8); // 30% upside, qualifies
    seed(repo, "MISS", 100, 105, 8); // 5% upside, fails threshold
    seed(repo, "THIN", 100, 200, 2); // fails analyst gate

    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);
    const [result] = evaluateScreens(
      repo,
      registry,
      resolveConfig(),
      [baseScreen],
      ASOF,
    );

    expect(result?.resolution).toEqual({ enabled: true });
    expect(result?.matches).toEqual([
      {
        ticker: "HIT",
        impliedUpside: 0.3,
        medianTarget: 130,
        latestClose: 100,
        numAnalysts: 8,
      },
    ]);
  });

  it("reports a screen with unserved capabilities as disabled with the missing capability named, and evaluates nothing for it", () => {
    const repo = new Repository(":memory:");
    seed(repo, "HIT", 100, 130, 8);
    const registry = new ProviderRegistry([providerWith("closes")]);

    const [result] = evaluateScreens(
      repo,
      registry,
      resolveConfig(),
      [baseScreen],
      ASOF,
    );
    expect(result?.resolution).toEqual({
      enabled: false,
      missing: ["analystTargets"],
    });
    expect(result?.matches).toEqual([]);
  });

  it("the as-of date bounds every read: an earlier asOf sees the earlier world", () => {
    const repo = new Repository(":memory:");
    repo.addInstrument("ACME", "2026-01-01");
    repo.insertCloses([
      { ticker: "ACME", date: "2026-07-01", close: 100 },
      { ticker: "ACME", date: ASOF, close: 200 },
    ]);
    repo.insertAnalystSnapshot({
      ticker: "ACME",
      asOf: "2026-07-01",
      medianTarget: 130, // 30% upside vs the 100 close of that date
      numAnalysts: 8,
    });
    repo.insertAnalystSnapshot({
      ticker: "ACME",
      asOf: ASOF,
      medianTarget: 210, // 5% upside vs the 200 close: no match today
      numAnalysts: 8,
    });
    repo.setInstrumentState("ACME", "ready");
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);
    const config = resolveConfig();

    const [today] = evaluateScreens(repo, registry, config, [baseScreen], ASOF);
    expect(today?.matches).toEqual([]);

    const [past] = evaluateScreens(
      repo,
      registry,
      config,
      [baseScreen],
      "2026-07-01",
    );
    expect(past?.matches).toHaveLength(1);
    expect(past?.matches[0]?.latestClose).toBe(100);
  });

  it("instruments with no data as of the evaluation date are skipped, not fabricated", () => {
    const repo = new Repository(":memory:");
    seed(repo, "ACME", 100, 130, 8);
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);
    // Evaluate before any stored data existed.
    const [result] = evaluateScreens(
      repo,
      registry,
      resolveConfig(),
      [baseScreen],
      "2020-01-01",
    );
    expect(result?.resolution).toEqual({ enabled: true });
    expect(result?.matches).toEqual([]);
  });
});
