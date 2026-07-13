import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config/index.js";
import { ProviderRegistry } from "../providers/registry.js";
import { Repository } from "../storage/repository.js";
import { providerWith } from "../test-support/fakeProvider.js";
import { buildDashboard } from "./dashboard.js";

const ASOF = "2026-07-31";

/**
 * Integration: stored observations in, rendered dashboard out — the M6
 * Definition of Done ("driven only by stored data"), crossing the
 * storage → app → screens → ui seams in one pass.
 */
describe("buildDashboard — storage to rendered text (backlog 018)", () => {
  const seedCommon = async (
    repo: Repository,
    ticker: string,
  ): Promise<void> => {
    await repo.addInstrument(ticker, "2026-01-01");
    await repo.insertAnalystSnapshot({
      ticker,
      asOf: ASOF,
      medianTarget: 142.5, // vs close 114: exactly 25% upside
      numAnalysts: 8,
    });
    await repo.setInstrumentState(ticker, "ready");
  };

  /** The pinned §5.2 volatile series: 4 completed ±10% fluctuations. */
  const seedVolatileCloses = async (
    repo: Repository,
    ticker: string,
  ): Promise<void> => {
    await repo.insertCloses(
      [100, 112, 98, 113, 99, 114].map((close, i) => ({
        ticker,
        date: `2026-07-${String(i + 1).padStart(2, "0")}`,
        close,
      })),
    );
  };

  it("renders all three categories from stored data alone", async () => {
    const repo = new Repository(":memory:");
    await seedCommon(repo, "ACME");
    await seedVolatileCloses(repo, "ACME"); // category 1 match
    await repo.insertEarningsSnapshot({
      ticker: "ACME",
      asOf: ASOF,
      nextEarningsDate: "2026-08-07", // category 2 match, 7 days out
    });
    await repo.insertDividendSnapshot({
      ticker: "ACME",
      asOf: ASOF,
      nextExDivDate: "2026-08-14", // category 3 match, at the boundary
    });
    const registry = new ProviderRegistry([
      providerWith(
        "closes",
        "analystTargets",
        "earningsCalendar",
        "dividendCalendar",
      ),
    ]);

    const text = await buildDashboard(repo, registry, resolveConfig(), ASOF);

    expect(text).toContain("research candidates as of 2026-07-31");
    // Currency was never reported by a provider: explicit "?", not blank.
    expect(text).toMatch(
      /ACME[ ]+25\.0%[ ]+142\.50 \?[ ]+114\.00 \?[ ]+8[ ]+4/,
    );
    expect(text).toMatch(/ACME[ ]+25\.0%[ ]+7[ ]+2026-08-07[ ]+8/);
    expect(text).toMatch(/ACME[ ]+25\.0%[ ]+14[ ]+2026-08-14[ ]+8/);
  });

  it("renders reported currency natively end-to-end", async () => {
    const repo = new Repository(":memory:");
    await seedCommon(repo, "ACME");
    await seedVolatileCloses(repo, "ACME");
    await repo.setInstrumentCurrency("ACME", "EUR");
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);

    const text = await buildDashboard(repo, registry, resolveConfig(), ASOF);
    expect(text).toMatch(/ACME[ ]+25\.0%[ ]+142\.50 EUR[ ]+114\.00 EUR/);
  });

  it("renders disabled screens with their missing capabilities when the registry cannot serve them", async () => {
    const repo = new Repository(":memory:");
    await seedCommon(repo, "ACME");
    await seedVolatileCloses(repo, "ACME");
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);

    const text = await buildDashboard(repo, registry, resolveConfig(), ASOF);
    expect(text).toMatch(/ACME[ ]+25\.0%/); // category 1 still evaluates
    expect(text).toContain(
      "unavailable — missing capability: earningsCalendar",
    );
    expect(text).toContain(
      "unavailable — missing capability: dividendCalendar",
    );
  });
});
