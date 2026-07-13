import { describe, expect, it } from "vitest";
import { evaluateScreens } from "../app/evaluateScreens.js";
import { resolveConfig } from "../config/index.js";
import { ProviderRegistry } from "../providers/registry.js";
import { Repository } from "../storage/repository.js";
import { providerWith } from "../test-support/fakeProvider.js";
import { instrumentSnapshot } from "../test-support/instrumentSnapshot.js";
import type { IsoDate } from "../types/index.js";
import { makeCategory3Screen } from "./category3.js";
import type { InstrumentSnapshot } from "./screen.js";

const ASOF = "2026-07-31";
/** Shared-builder analyst target: 130/100 = exactly 30% implied upside. */
const TARGET = 130;

const snapshot = (
  nextExDivDate: IsoDate | null,
  overrides: Partial<InstrumentSnapshot> = {},
): InstrumentSnapshot =>
  instrumentSnapshot({
    dividend: { ticker: "ACME", asOf: ASOF, nextExDivDate },
    ...overrides,
  });

describe("category 3 — pre-ex-dividend + undervalued (MVP.md §6 row 3)", () => {
  it("matches BASE with an ex-dividend date inside the window, carrying the §8 row numbers", () => {
    const screen = makeCategory3Screen(resolveConfig());
    expect(screen.requiredCapabilities).toEqual([
      "analystTargets",
      "dividendCalendar",
      "closes",
    ]);
    expect(screen.evaluate(snapshot("2026-08-07"))).toEqual({
      ticker: "ACME",
      currency: "USD",
      impliedUpside: 0.3,
      medianTarget: TARGET,
      latestClose: 100,
      numAnalysts: 8,
      daysToExDiv: 7,
      nextExDivDate: "2026-08-07",
    });
  });

  it("window boundaries are inclusive: ex-div today (0) and at windowDays (14) match, 15 does not", () => {
    const screen = makeCategory3Screen(resolveConfig());
    expect(screen.evaluate(snapshot(ASOF))?.daysToExDiv).toBe(0);
    expect(screen.evaluate(snapshot("2026-08-14"))?.daysToExDiv).toBe(14);
    expect(screen.evaluate(snapshot("2026-08-15"))).toBeNull();
  });

  it("a past ex-dividend date never qualifies — upcoming-only", () => {
    const screen = makeCategory3Screen(resolveConfig());
    expect(screen.evaluate(snapshot("2026-07-30"))).toBeNull();
  });

  it("missing data means no match: no dividend snapshot, or none announcing a date", () => {
    const screen = makeCategory3Screen(resolveConfig());
    expect(screen.evaluate(snapshot(null))).toBeNull();
    expect(
      screen.evaluate({ ...snapshot("2026-08-07"), dividend: null }),
    ).toBeNull();
  });

  it("BASE still gates: an imminent ex-div with insufficient upside or analysts is no match", () => {
    const screen = makeCategory3Screen(resolveConfig());
    expect(
      screen.evaluate(
        snapshot("2026-08-07", {
          analyst: {
            ticker: "ACME",
            asOf: ASOF,
            medianTarget: 110, // 10% upside: below the default 20%
            numAnalysts: 8,
          },
        }),
      ),
    ).toBeNull();
    expect(
      screen.evaluate(
        snapshot("2026-08-07", {
          analyst: {
            ticker: "ACME",
            asOf: ASOF,
            medianTarget: TARGET,
            numAnalysts: 2,
          },
        }),
      ),
    ).toBeNull();
  });

  it("windowDays comes from config.exDividend: a 7-day override excludes a day-10 event", () => {
    const screen = makeCategory3Screen(
      resolveConfig({ exDividend: { windowDays: 7 } }),
    );
    expect(screen.evaluate(snapshot("2026-08-10"))).toBeNull();
    expect(screen.evaluate(snapshot("2026-08-07"))).not.toBeNull();
  });

  it("reads ITS OWN upsideThreshold: a category3-only override excludes the 30%-upside fixture", () => {
    // Guards the copy-paste hazard screen.ts warns about: with identical
    // defaults, reading category1's or category2's config path would keep
    // this green.
    const screen = makeCategory3Screen(
      resolveConfig({ screens: { category3: { upsideThreshold: 0.4 } } }),
    );
    expect(screen.evaluate(snapshot("2026-08-07"))).toBeNull();
  });
});

describe("category 3 — end-to-end through the harness (backlog 017)", () => {
  const seed = async (
    repo: Repository,
    ticker: string,
    nextExDivDate: IsoDate | null,
    medianTarget = TARGET,
  ) => {
    await repo.addInstrument(ticker, "2026-01-01");
    await repo.insertCloses([{ ticker, date: ASOF, close: 100 }]);
    await repo.insertAnalystSnapshot({
      ticker,
      asOf: ASOF,
      medianTarget,
      numAnalysts: 8,
    });
    await repo.insertDividendSnapshot({ ticker, asOf: ASOF, nextExDivDate });
    await repo.setInstrumentState(ticker, "ready");
  };

  it("returns exactly the right matches from stored data, including boundary and past-date exclusions", async () => {
    const repo = new Repository(":memory:");
    await seed(repo, "SOON", "2026-08-07"); // in window + undervalued: match
    await seed(repo, "EDGE", "2026-08-14"); // exactly at windowDays: match
    await seed(repo, "LATER", "2026-08-15"); // one day past the window
    await seed(repo, "PAST", "2026-07-30"); // already went ex-dividend
    await seed(repo, "NODATE", null); // no scheduled ex-div date
    await seed(repo, "PRICEY", "2026-08-07", 105); // fails only the upside gate
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets", "dividendCalendar"),
    ]);
    const config = resolveConfig();

    const [result] = await evaluateScreens(
      repo,
      registry,
      config,
      [makeCategory3Screen(config)],
      ASOF,
    );
    expect(result?.resolution).toEqual({ enabled: true });
    expect(result?.matches.map((m) => m.ticker)).toEqual(["EDGE", "SOON"]);
    expect(result?.matches.map((m) => m.daysToExDiv)).toEqual([14, 7]);
  });

  it("disables with the missing capability named when dividendCalendar is unserved", async () => {
    const repo = new Repository(":memory:");
    await seed(repo, "SOON", "2026-08-07");
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);
    const config = resolveConfig();

    const [result] = await evaluateScreens(
      repo,
      registry,
      config,
      [makeCategory3Screen(config)],
      ASOF,
    );
    expect(result?.resolution).toEqual({
      enabled: false,
      missing: ["dividendCalendar"],
    });
    expect(result?.matches).toEqual([]);
  });
});
