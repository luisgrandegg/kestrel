import { describe, expect, it } from "vitest";
import type { Category1Match } from "../screens/category1.js";
import type { Category2Match } from "../screens/category2.js";
import type { Category3Match } from "../screens/category3.js";
import type { ScreenEvaluation } from "../types/index.js";
import { type DashboardInput, renderDashboard } from "./dashboard.js";

const enabled = <Match>(
  screenId: string,
  matches: Match[],
): ScreenEvaluation<Match> => ({
  screenId,
  resolution: { enabled: true },
  matches,
});

const c1 = (overrides: Partial<Category1Match> = {}): Category1Match => ({
  ticker: "ACME",
  currency: "USD",
  impliedUpside: 0.25,
  medianTarget: 142.5,
  latestClose: 114,
  numAnalysts: 8,
  completedFluctuations: 4,
  ...overrides,
});

const input = (overrides: Partial<DashboardInput> = {}): DashboardInput => ({
  asOf: "2026-07-31",
  category1: enabled<Category1Match>("category1", [c1()]),
  category2: enabled<Category2Match>("category2", [
    {
      ticker: "BOLT",
      currency: "EUR",
      impliedUpside: 0.3,
      medianTarget: 130,
      latestClose: 100,
      numAnalysts: 6,
      daysToEarnings: 7,
      nextEarningsDate: "2026-08-07",
    },
  ]),
  category3: enabled<Category3Match>("category3", [
    {
      ticker: "CARGO",
      currency: "GBP",
      impliedUpside: 0.21,
      medianTarget: 121,
      latestClose: 100,
      numAnalysts: 5,
      daysToExDiv: 14,
      nextExDivDate: "2026-08-14",
    },
  ]),
  ...overrides,
});

describe("renderDashboard — MVP.md §8 (backlog 018)", () => {
  it("renders all three categories with their per-row fields", () => {
    const text = renderDashboard(input());

    expect(text).toContain("research candidates as of 2026-07-31");
    expect(text).toContain("Category 1 — volatile + undervalued");
    // Category 1 row: ticker, upside %, median target, latest close,
    // analysts, fluctuation count.
    expect(text).toMatch(/ACME\s+25\.0%\s+142\.50 USD\s+114\.00 USD\s+8\s+4/);
    // Category 2 row: ticker, upside %, days to earnings, date, analysts.
    expect(text).toContain("Category 2 — pre-earnings + undervalued");
    expect(text).toMatch(/BOLT\s+30\.0%\s+7\s+2026-08-07\s+6/);
    // Category 3 row: ticker, upside %, days to ex-div, date, analysts.
    expect(text).toContain("Category 3 — pre-ex-dividend + undervalued");
    expect(text).toMatch(/CARGO\s+21\.0%\s+14\s+2026-08-14\s+5/);
  });

  it("renders a disabled screen as unavailable with the missing capabilities named", () => {
    const text = renderDashboard(
      input({
        category2: {
          screenId: "category2",
          resolution: {
            enabled: false,
            missing: ["earningsCalendar", "analystTargets"],
          },
          matches: [],
        },
      }),
    );
    expect(text).toContain(
      "unavailable — missing capability: earningsCalendar, analystTargets",
    );
    // The other categories still render.
    expect(text).toMatch(/ACME/);
    expect(text).toMatch(/CARGO/);
  });

  it("shows mixed currencies natively, unconverted — and '?' when unreported", () => {
    const text = renderDashboard(
      input({
        category1: enabled<Category1Match>("category1", [
          c1(),
          c1({ ticker: "UMLAUT", currency: "EUR" }),
          c1({ ticker: "MYSTERY", currency: null }),
        ]),
      }),
    );
    expect(text).toMatch(/ACME\s+.*142\.50 USD/);
    expect(text).toMatch(/UMLAUT\s+.*142\.50 EUR/);
    expect(text).toMatch(/MYSTERY\s+.*142\.50 \?/);
  });

  it("renders an empty enabled screen as 'no matches', distinct from disabled", () => {
    const text = renderDashboard(
      input({ category1: enabled<Category1Match>("category1", []) }),
    );
    expect(text).toContain("Category 1 — volatile + undervalued");
    expect(text).toContain("no matches");
    expect(text).not.toContain("missing capability");
  });

  it("frames results as research candidates, never advice", () => {
    const text = renderDashboard(input());
    expect(text).toContain("not recommendations");
  });
});
