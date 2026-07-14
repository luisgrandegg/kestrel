import { resolveConfig } from "@kestrel/core/config";
import type { StorageRepository } from "@kestrel/core/storage/port";
import { Repository } from "@kestrel/core/storage/repository";
import { ProviderRegistry } from "@kestrel/ingest/providers/registry";
import { providerWith } from "@kestrel/ingest/test-support/fakeProvider";
import { describe, expect, it } from "vitest";
import { configFromEnv, getDashboardData, watchlist } from "./pipeline";

const ASOF = "2026-07-31";

/**
 * getDashboardData is typed against the StorageRepository PORT, so it runs
 * here over the SQLite engine exactly as it runs over Postgres in
 * production — the engine-agnosticism the seam guarantees. Seeding mirrors
 * apps/cli/src/app/dashboard.test.ts (the text renderer's twin).
 */
describe("getDashboardData — storage to typed screen evaluations", () => {
  const seed = async (repo: StorageRepository): Promise<void> => {
    await repo.addInstrument("ACME", "2026-01-01");
    await repo.insertAnalystSnapshot({
      ticker: "ACME",
      asOf: ASOF,
      medianTarget: 142.5, // vs close 114: exactly 25% upside
      numAnalysts: 8,
    });
    // The pinned §5.2 volatile series: 4 completed ±10% fluctuations.
    await repo.insertCloses(
      [100, 112, 98, 113, 99, 114].map((close, i) => ({
        ticker: "ACME",
        date: `2026-07-${String(i + 1).padStart(2, "0")}`,
        close,
      })),
    );
    await repo.setInstrumentState("ACME", "ready");
  };

  it("returns all three categories' matches from stored data alone", async () => {
    // The assignment is the engine-agnosticism proof: getDashboardData's
    // repo parameter is the port, satisfied here by the SQLite engine.
    const repo: StorageRepository = new Repository(":memory:");
    await seed(repo);
    await repo.insertEarningsSnapshot({
      ticker: "ACME",
      asOf: ASOF,
      nextEarningsDate: "2026-08-07", // 7 days out
    });
    await repo.insertDividendSnapshot({
      ticker: "ACME",
      asOf: ASOF,
      nextExDivDate: "2026-08-14", // at the window boundary
    });
    const registry = new ProviderRegistry([
      providerWith(
        "closes",
        "analystTargets",
        "earningsCalendar",
        "dividendCalendar",
      ),
    ]);

    const data = await getDashboardData(repo, registry, resolveConfig(), ASOF);

    expect(data.asOf).toBe(ASOF);
    expect(data.category1.resolution.enabled).toBe(true);
    expect(data.category1.matches).toEqual([
      {
        ticker: "ACME",
        impliedUpside: 0.25,
        medianTarget: 142.5,
        latestClose: 114,
        numAnalysts: 8,
        currency: null, // never reported by a provider — explicit null
        completedFluctuations: 4,
      },
    ]);
    expect(data.category2.matches).toEqual([
      expect.objectContaining({
        ticker: "ACME",
        daysToEarnings: 7,
        nextEarningsDate: "2026-08-07",
        numAnalysts: 8,
      }),
    ]);
    expect(data.category3.matches).toEqual([
      expect.objectContaining({
        ticker: "ACME",
        daysToExDiv: 14,
        nextExDivDate: "2026-08-14",
      }),
    ]);
  });

  it("reports disabled screens with their missing capabilities, never fabricated matches", async () => {
    const repo = new Repository(":memory:");
    await seed(repo);
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);

    const data = await getDashboardData(repo, registry, resolveConfig(), ASOF);

    expect(data.category1.matches).toHaveLength(1); // still evaluates
    expect(data.category2.resolution).toEqual({
      enabled: false,
      missing: ["earningsCalendar"],
    });
    expect(data.category2.matches).toEqual([]);
    expect(data.category3.resolution).toEqual({
      enabled: false,
      missing: ["dividendCalendar"],
    });
  });

  it("evaluates against an empty registry as all-disabled (today's production state)", async () => {
    const repo = new Repository(":memory:");
    await seed(repo);

    const data = await getDashboardData(
      repo,
      new ProviderRegistry([]),
      resolveConfig(),
      ASOF,
    );

    for (const evaluation of [data.category1, data.category2, data.category3]) {
      expect(evaluation.resolution.enabled).toBe(false);
      expect(evaluation.matches).toEqual([]);
    }
  });
});

describe("configFromEnv — the KESTREL_CONFIG override path", () => {
  it("returns the §9 defaults when the variable is unset or blank", () => {
    expect(configFromEnv(undefined)).toEqual(resolveConfig());
    expect(configFromEnv("  ")).toEqual(resolveConfig());
  });

  it("merges a JSON object of overrides over the defaults", () => {
    const config = configFromEnv(
      '{"minAnalysts": 7, "screens": {"category1": {"upsideThreshold": 0.4}}}',
    );
    expect(config.minAnalysts).toBe(7);
    expect(config.screens.category1.upsideThreshold).toBe(0.4);
    // Untouched keys keep their §9 defaults.
    expect(config.screens.category2.upsideThreshold).toBe(0.2);
  });

  it("fails loud on invalid JSON instead of silently using defaults", () => {
    expect(() => configFromEnv("{not json")).toThrow(
      "KESTREL_CONFIG is not valid JSON",
    );
  });

  it("fails loud on JSON that is not an object", () => {
    expect(() => configFromEnv('["minAnalysts", 7]')).toThrow(
      "must be a JSON object",
    );
  });

  it("fails loud on unknown keys (delegated to resolveConfig)", () => {
    expect(() => configFromEnv('{"minAnalyst": 7}')).toThrow(
      'Unknown config key: "minAnalyst"',
    );
  });
});

describe("watchlist — bundled from the repo-root watchlist.json", () => {
  it("returns normalized, deduped tickers", () => {
    const tickers = watchlist();
    expect(tickers.length).toBeGreaterThan(0);
    expect(new Set(tickers).size).toBe(tickers.length);
    for (const ticker of tickers) {
      expect(ticker).toBe(ticker.trim().toUpperCase());
    }
  });
});
