import { describe, expect, it } from "vitest";
import { evaluateScreens } from "../app/evaluateScreens.js";
import { resolveConfig } from "../config/index.js";
import { ProviderRegistry } from "../providers/registry.js";
import { Repository } from "../storage/repository.js";
import { providerWith } from "../test-support/fakeProvider.js";
import { instrumentSnapshot } from "../test-support/instrumentSnapshot.js";
import type { IsoDate } from "../types/index.js";
import { makeCategory2Screen } from "./category2.js";
import type { InstrumentSnapshot } from "./screen.js";

const ASOF = "2026-07-31";
/** 130/100 = exactly 30% implied upside vs the fixture close of 100. */
const TARGET = 130;

const snapshot = (
  nextEarningsDate: IsoDate | null,
  overrides: Partial<InstrumentSnapshot> = {},
): InstrumentSnapshot =>
  instrumentSnapshot({
    earnings: { ticker: "ACME", asOf: ASOF, nextEarningsDate },
    ...overrides,
  });

describe("category 2 — pre-earnings + undervalued (MVP.md §6 row 2)", () => {
  it("matches BASE with earnings inside the window, carrying the §8 row numbers", () => {
    const screen = makeCategory2Screen(resolveConfig());
    expect(screen.requiredCapabilities).toEqual([
      "analystTargets",
      "earningsCalendar",
      "closes",
    ]);
    expect(screen.evaluate(snapshot("2026-08-07"))).toEqual({
      ticker: "ACME",
      currency: "USD",
      impliedUpside: 0.3,
      medianTarget: TARGET,
      latestClose: 100,
      numAnalysts: 8,
      daysToEarnings: 7,
      nextEarningsDate: "2026-08-07",
    });
  });

  it("window boundaries are inclusive: earnings today (0) and at windowDays (14) both match", () => {
    const screen = makeCategory2Screen(resolveConfig());
    expect(screen.evaluate(snapshot(ASOF))?.daysToEarnings).toBe(0);
    expect(screen.evaluate(snapshot("2026-08-14"))?.daysToEarnings).toBe(14);
    // One day past the window: excluded.
    expect(screen.evaluate(snapshot("2026-08-15"))).toBeNull();
  });

  it("a past earnings date never qualifies — upcoming-only, not post-earnings drift", () => {
    const screen = makeCategory2Screen(resolveConfig());
    expect(screen.evaluate(snapshot("2026-07-30"))).toBeNull();
  });

  it("missing data means no match: no earnings snapshot, or none announcing a date", () => {
    const screen = makeCategory2Screen(resolveConfig());
    expect(screen.evaluate(snapshot(null))).toBeNull(); // observed: no date scheduled
    expect(
      screen.evaluate({ ...snapshot("2026-08-07"), earnings: null }),
    ).toBeNull();
  });

  it("BASE still gates: an imminent report with insufficient upside or analysts is no match", () => {
    const screen = makeCategory2Screen(resolveConfig());
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

  it("windowDays comes from config: a 7-day override excludes a day-10 event", () => {
    const screen = makeCategory2Screen(
      resolveConfig({ earnings: { windowDays: 7 } }),
    );
    expect(screen.evaluate(snapshot("2026-08-10"))).toBeNull();
    expect(screen.evaluate(snapshot("2026-08-07"))).not.toBeNull();
  });

  it("reads ITS OWN upsideThreshold: a category2-only override excludes the 30%-upside fixture", () => {
    // Guards the copy-paste hazard screen.ts warns about: with identical
    // defaults, reading category1's config path would keep this green.
    const screen = makeCategory2Screen(
      resolveConfig({ screens: { category2: { upsideThreshold: 0.4 } } }),
    );
    expect(screen.evaluate(snapshot("2026-08-07"))).toBeNull();
  });
});

describe("category 2 — end-to-end through the harness (backlog 016)", () => {
  const seed = (
    repo: Repository,
    ticker: string,
    nextEarningsDate: IsoDate | null,
    medianTarget = TARGET,
  ) => {
    repo.addInstrument(ticker, "2026-01-01");
    repo.insertCloses([{ ticker, date: ASOF, close: 100 }]);
    repo.insertAnalystSnapshot({
      ticker,
      asOf: ASOF,
      medianTarget,
      numAnalysts: 8,
    });
    repo.insertEarningsSnapshot({ ticker, asOf: ASOF, nextEarningsDate });
    repo.setInstrumentState(ticker, "ready");
  };

  it("returns exactly the right matches from stored data", () => {
    const repo = new Repository(":memory:");
    seed(repo, "SOON", "2026-08-07"); // in window + undervalued: the only match
    seed(repo, "LATER", "2026-09-30"); // undervalued, event outside window
    seed(repo, "PAST", "2026-07-01"); // undervalued, event already happened
    seed(repo, "NODATE", null); // undervalued, no scheduled report
    seed(repo, "PRICEY", "2026-08-07", 105); // in window, fails only the upside gate
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets", "earningsCalendar"),
    ]);
    const config = resolveConfig();

    const [result] = evaluateScreens(
      repo,
      registry,
      config,
      [makeCategory2Screen(config)],
      ASOF,
    );
    expect(result?.resolution).toEqual({ enabled: true });
    expect(result?.matches.map((m) => m.ticker)).toEqual(["SOON"]);
    expect(result?.matches[0]?.daysToEarnings).toBe(7);
    expect(result?.matches[0]?.nextEarningsDate).toBe("2026-08-07");
  });

  it("disables with the missing capability named when earningsCalendar is unserved", () => {
    const repo = new Repository(":memory:");
    seed(repo, "SOON", "2026-08-07");
    const registry = new ProviderRegistry([
      providerWith("closes", "analystTargets"),
    ]);
    const config = resolveConfig();

    const [result] = evaluateScreens(
      repo,
      registry,
      config,
      [makeCategory2Screen(config)],
      ASOF,
    );
    expect(result?.resolution).toEqual({
      enabled: false,
      missing: ["earningsCalendar"],
    });
    expect(result?.matches).toEqual([]);
  });
});
