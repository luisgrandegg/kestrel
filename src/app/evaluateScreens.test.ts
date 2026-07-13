import { describe, expect, it } from "vitest";
import { type KestrelConfig, resolveConfig } from "../config/index.js";
import { ProviderRegistry } from "../providers/registry.js";
import { type BaseMatch, evaluateBase } from "../screens/base.js";
import type { Screen } from "../screens/screen.js";
import { Repository } from "../storage/repository.js";
import { providerWith } from "../test-support/fakeProvider.js";
import {
  buildSnapshots,
  evaluateScreen,
  evaluateScreens,
} from "./evaluateScreens.js";

const ASOF = "2026-07-10";

/**
 * A minimal base-predicate screen for exercising the harness end-to-end.
 * Thresholds are bound at construction from the caller's config — the
 * pattern items 015-017 follow — so evaluate carries no config path to
 * get wrong.
 */
const makeBaseScreen = (config: KestrelConfig): Screen<BaseMatch> => ({
  id: "base-only",
  requiredCapabilities: ["closes", "analystTargets"],
  evaluate: (snapshot) =>
    evaluateBase(
      snapshot,
      config.minAnalysts,
      config.screens.category1.upsideThreshold,
    ),
});

const seed = async (
  repo: Repository,
  ticker: string,
  close: number,
  medianTarget: number,
  numAnalysts: number,
): Promise<void> => {
  await repo.addInstrument(ticker, "2026-01-01");
  await repo.insertCloses([{ ticker, date: ASOF, close }]);
  await repo.insertAnalystSnapshot({
    ticker,
    asOf: ASOF,
    medianTarget,
    numAnalysts,
  });
  await repo.setInstrumentState(ticker, "ready");
};

describe("evaluateScreens — harness over fixture storage (backlog 014)", () => {
  it("evaluates enabled screens over ready instruments and returns matches with supporting numbers", async () => {
    const repo = new Repository(":memory:");
    await seed(repo, "HIT", 100, 130, 8); // 30% upside, qualifies
    await seed(repo, "MISS", 100, 105, 8); // 5% upside, fails threshold
    await seed(repo, "THIN", 100, 200, 2); // fails analyst gate

    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);
    const config = resolveConfig();
    const [result] = await evaluateScreens(
      repo,
      registry,
      config,
      [makeBaseScreen(config)],
      ASOF,
    );

    expect(result?.resolution).toEqual({ enabled: true });
    expect(result?.matches).toEqual([
      {
        ticker: "HIT",
        currency: null, // no provider has reported a currency yet
        impliedUpside: 0.3,
        medianTarget: 130,
        latestClose: 100,
        numAnalysts: 8,
      },
    ]);
  });

  it("reports a screen with unserved capabilities as disabled with the missing capability named, and evaluates nothing for it", async () => {
    const repo = new Repository(":memory:");
    await seed(repo, "HIT", 100, 130, 8);
    const registry = new ProviderRegistry([providerWith("closes")]);
    const config = resolveConfig();

    const [result] = await evaluateScreens(
      repo,
      registry,
      config,
      [makeBaseScreen(config)],
      ASOF,
    );
    expect(result?.resolution).toEqual({
      enabled: false,
      missing: ["analystTargets"],
    });
    expect(result?.matches).toEqual([]);
  });

  it("bounds every observation read by the as-of date (the instrument set itself reflects current lifecycle state)", async () => {
    const repo = new Repository(":memory:");
    await repo.addInstrument("ACME", "2026-01-01");
    await repo.insertCloses([
      { ticker: "ACME", date: "2026-07-01", close: 100 },
      { ticker: "ACME", date: ASOF, close: 200 },
    ]);
    await repo.insertAnalystSnapshot({
      ticker: "ACME",
      asOf: "2026-07-01",
      medianTarget: 130, // 30% upside vs the 100 close of that date
      numAnalysts: 8,
    });
    await repo.insertAnalystSnapshot({
      ticker: "ACME",
      asOf: ASOF,
      medianTarget: 210, // 5% upside vs the 200 close: no match today
      numAnalysts: 8,
    });
    await repo.setInstrumentState("ACME", "ready");
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);
    const config = resolveConfig();
    const screens = [makeBaseScreen(config)];

    const [today] = await evaluateScreens(
      repo,
      registry,
      config,
      screens,
      ASOF,
    );
    expect(today?.matches).toEqual([]);

    const [past] = await evaluateScreens(
      repo,
      registry,
      config,
      screens,
      "2026-07-01",
    );
    expect(past?.matches).toHaveLength(1);
    expect(past?.matches[0]?.latestClose).toBe(100);
  });

  it("rejects a malformed as-of date loudly instead of silently reading the future", async () => {
    const repo = new Repository(":memory:");
    await seed(repo, "ACME", 100, 130, 8);
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);
    const config = resolveConfig();

    // "2026-7-1" sorts AFTER every zero-padded 2026-07-xx date; unchecked,
    // it would read months past the intended bound (guardrail 2).
    await expect(
      evaluateScreens(
        repo,
        registry,
        config,
        [makeBaseScreen(config)],
        "2026-7-1",
      ),
    ).rejects.toThrow(RangeError);
  });

  it("instruments with no data as of the evaluation date are skipped, not fabricated", async () => {
    const repo = new Repository(":memory:");
    await seed(repo, "ACME", 100, 130, 8);
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);
    const config = resolveConfig();
    // Evaluate before any stored data existed.
    const [result] = await evaluateScreens(
      repo,
      registry,
      config,
      [makeBaseScreen(config)],
      "2020-01-01",
    );
    expect(result?.resolution).toEqual({ enabled: true });
    expect(result?.matches).toEqual([]);
  });

  it("buildSnapshots + evaluateScreen let heterogeneous screens share one snapshot read, each keeping its own match type", async () => {
    const repo = new Repository(":memory:");
    await seed(repo, "HIT", 100, 130, 8);
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);
    const config = resolveConfig();

    const snapshots = await buildSnapshots(repo, config, ASOF);
    const base = evaluateScreen(snapshots, registry, makeBaseScreen(config));
    const tickersOnly = evaluateScreen(snapshots, registry, {
      id: "tickers-only",
      requiredCapabilities: ["closes"],
      evaluate: (snapshot) => ({ onlyTicker: snapshot.ticker }),
    });

    // Distinct match shapes, no casts: each result is typed by its screen.
    expect(base.matches[0]?.impliedUpside).toBe(0.3);
    expect(tickersOnly.matches).toEqual([{ onlyTicker: "HIT" }]);
  });
});
