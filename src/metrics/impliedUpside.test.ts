import { describe, expect, it } from "vitest";
import { impliedUpside } from "./impliedUpside.js";

/**
 * Tests for the implied-upside metric (backlog item 007) — MVP.md §5.1.
 * Written with the implementation per CLAUDE.md's test-first mandate.
 */

describe("impliedUpside — formula (MVP.md §5.1)", () => {
  it("computes (medianTarget − latestClose) / latestClose", () => {
    const result = impliedUpside({
      medianTarget: 120,
      latestClose: 100,
      numAnalysts: 5,
      minAnalysts: 5,
    });
    expect(result).toEqual({ qualified: true, impliedUpside: 0.2 });
  });

  it("returns negative upside when the target is below the close", () => {
    const result = impliedUpside({
      medianTarget: 80,
      latestClose: 100,
      numAnalysts: 10,
      minAnalysts: 5,
    });
    expect(result).toEqual({ qualified: true, impliedUpside: -0.2 });
  });

  it("returns zero upside when target equals close", () => {
    const result = impliedUpside({
      medianTarget: 50,
      latestClose: 50,
      numAnalysts: 6,
      minAnalysts: 5,
    });
    expect(result).toEqual({ qualified: true, impliedUpside: 0 });
  });
});

describe("impliedUpside — analyst quality gate (MVP.md §5.1)", () => {
  it("does not qualify below minAnalysts, and says why", () => {
    const result = impliedUpside({
      medianTarget: 200,
      latestClose: 100,
      numAnalysts: 4,
      minAnalysts: 5,
    });
    expect(result).toEqual({
      qualified: false,
      reason: "insufficient-analysts",
    });
  });

  it("qualifies at exactly minAnalysts (≥, not >)", () => {
    const result = impliedUpside({
      medianTarget: 110,
      latestClose: 100,
      numAnalysts: 5,
      minAnalysts: 5,
    });
    expect(result.qualified).toBe(true);
  });

  it("minAnalysts is a parameter: a stricter gate disqualifies the same input", () => {
    const input = {
      medianTarget: 110,
      latestClose: 100,
      numAnalysts: 7,
    };
    expect(impliedUpside({ ...input, minAnalysts: 5 }).qualified).toBe(true);
    expect(impliedUpside({ ...input, minAnalysts: 8 }).qualified).toBe(false);
  });

  it("zero analysts never qualifies against a positive gate", () => {
    const result = impliedUpside({
      medianTarget: 110,
      latestClose: 100,
      numAnalysts: 0,
      minAnalysts: 5,
    });
    expect(result.qualified).toBe(false);
  });
});

describe("impliedUpside — fail-loud numeric edges (CONSTITUTION.md §5)", () => {
  it("throws on zero or negative latestClose instead of dividing by it", () => {
    expect(() =>
      impliedUpside({
        medianTarget: 100,
        latestClose: 0,
        numAnalysts: 5,
        minAnalysts: 5,
      }),
    ).toThrow(RangeError);
    expect(() =>
      impliedUpside({
        medianTarget: 100,
        latestClose: -10,
        numAnalysts: 5,
        minAnalysts: 5,
      }),
    ).toThrow(RangeError);
  });

  it("throws on non-finite or non-positive medianTarget", () => {
    for (const medianTarget of [Number.NaN, Number.POSITIVE_INFINITY, 0, -50]) {
      expect(() =>
        impliedUpside({
          medianTarget,
          latestClose: 100,
          numAnalysts: 5,
          minAnalysts: 5,
        }),
      ).toThrow(RangeError);
    }
  });

  it("throws on a missing/invalid analyst count instead of silently disqualifying", () => {
    for (const numAnalysts of [Number.NaN, -1, 2.5]) {
      expect(() =>
        impliedUpside({
          medianTarget: 120,
          latestClose: 100,
          numAnalysts,
          minAnalysts: 5,
        }),
      ).toThrow(RangeError);
    }
  });

  it("throws on an invalid gate", () => {
    for (const minAnalysts of [Number.NaN, -1, 2.5]) {
      expect(() =>
        impliedUpside({
          medianTarget: 120,
          latestClose: 100,
          numAnalysts: 5,
          minAnalysts,
        }),
      ).toThrow(RangeError);
    }
  });
});
