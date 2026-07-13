import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config/index.js";
import { instrumentSnapshot as snapshot } from "../test-support/instrumentSnapshot.js";
import { evaluateBase } from "./base.js";

describe("evaluateBase — MVP.md §6 base predicate", () => {
  it("matches when numAnalysts >= minAnalysts and impliedUpside >= threshold, carrying the supporting numbers", () => {
    const config = resolveConfig();
    const match = evaluateBase(
      snapshot(),
      config.minAnalysts,
      config.screens.category1.upsideThreshold,
    );
    expect(match).toEqual({
      ticker: "ACME",
      currency: "USD",
      impliedUpside: 0.3,
      medianTarget: 130,
      latestClose: 100,
      numAnalysts: 8,
    });
  });

  it("rejects upside below the threshold (>= semantics at the boundary)", () => {
    const config = resolveConfig();
    // 120/100 → exactly 20% = the default threshold: matches.
    expect(
      evaluateBase(
        snapshot({
          analyst: {
            ticker: "ACME",
            asOf: "2026-07-09",
            medianTarget: 120,
            numAnalysts: 8,
          },
        }),
        config.minAnalysts,
        config.screens.category1.upsideThreshold,
      ),
    ).not.toBeNull();
    // 119/100 → 19%: below.
    expect(
      evaluateBase(
        snapshot({
          analyst: {
            ticker: "ACME",
            asOf: "2026-07-09",
            medianTarget: 119,
            numAnalysts: 8,
          },
        }),
        config.minAnalysts,
        config.screens.category1.upsideThreshold,
      ),
    ).toBeNull();
  });

  it("per-screen upsideThreshold: the same instrument passes one screen's gate and fails another's", () => {
    const config = resolveConfig({
      screens: { category1: { upsideThreshold: 0.4 } },
    });
    const s = snapshot(); // 30% upside
    expect(
      evaluateBase(
        s,
        config.minAnalysts,
        config.screens.category1.upsideThreshold,
      ),
    ).toBeNull();
    expect(
      evaluateBase(
        s,
        config.minAnalysts,
        config.screens.category2.upsideThreshold,
      ),
    ).not.toBeNull();
  });

  it("the analyst quality gate applies in every screen", () => {
    const config = resolveConfig();
    expect(
      evaluateBase(
        snapshot({
          analyst: {
            ticker: "ACME",
            asOf: "2026-07-09",
            medianTarget: 200,
            numAnalysts: config.minAnalysts - 1,
          },
        }),
        config.minAnalysts,
        config.screens.category1.upsideThreshold,
      ),
    ).toBeNull();
  });

  it("missing analyst data means no match — never a fabricated zero", () => {
    const config = resolveConfig();
    expect(
      evaluateBase(
        snapshot({ analyst: null }),
        config.minAnalysts,
        config.screens.category1.upsideThreshold,
      ),
    ).toBeNull();
  });
});
