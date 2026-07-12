import { describe, expect, it } from "vitest";
import { impliedUpside } from "./impliedUpside.js";

/**
 * Tests for the implied-upside metric (backlog item 007) — MVP.md §5.1.
 * Written with the implementation per CLAUDE.md's test-first mandate.
 *
 * The formula tests keep every input inline so the expected arithmetic is
 * reader-verifiable; the gate and fail-loud blocks spread over `base` so the
 * field under test is the visible signal.
 */

const base = {
  medianTarget: 120,
  latestClose: 100,
  numAnalysts: 5,
  minAnalysts: 5,
};

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
    expect(impliedUpside({ ...base, numAnalysts: 4 })).toEqual({
      qualified: false,
      reason: "insufficient-analysts",
    });
  });

  it("qualifies at exactly minAnalysts (≥, not >)", () => {
    expect(impliedUpside({ ...base, numAnalysts: 5 }).qualified).toBe(true);
  });

  it("minAnalysts is a parameter: a stricter gate disqualifies the same input", () => {
    expect(
      impliedUpside({ ...base, numAnalysts: 7, minAnalysts: 5 }).qualified,
    ).toBe(true);
    expect(
      impliedUpside({ ...base, numAnalysts: 7, minAnalysts: 8 }).qualified,
    ).toBe(false);
  });

  it("zero analysts never qualifies against a positive gate", () => {
    expect(impliedUpside({ ...base, numAnalysts: 0 }).qualified).toBe(false);
  });
});

describe("impliedUpside — fail-loud numeric edges (CONSTITUTION.md §5)", () => {
  it("throws on zero or negative latestClose instead of dividing by it", () => {
    expect(() => impliedUpside({ ...base, latestClose: 0 })).toThrow(
      RangeError,
    );
    expect(() => impliedUpside({ ...base, latestClose: -10 })).toThrow(
      RangeError,
    );
  });

  it("throws when a near-zero close overflows the ratio to a non-finite value", () => {
    // A subnormal close passes the positive-finite guard, but the division
    // overflows: (120 − 1e-320) / 1e-320 → Infinity. Never hand a
    // non-finite "qualified" upside to the screens.
    expect(() => impliedUpside({ ...base, latestClose: 1e-320 })).toThrow(
      RangeError,
    );
  });

  it("a small but representable close still yields a finite result", () => {
    // Finite-but-extreme ratios are a data-quality concern owned by the
    // adapter boundary (see the DailyClose.close positivity contract) —
    // the metric only refuses to produce a non-finite number.
    const result = impliedUpside({ ...base, latestClose: 1e-6 });
    expect(result.qualified).toBe(true);
    if (result.qualified) {
      expect(Number.isFinite(result.impliedUpside)).toBe(true);
    }
  });

  it("throws on non-finite or non-positive medianTarget", () => {
    for (const medianTarget of [Number.NaN, Number.POSITIVE_INFINITY, 0, -50]) {
      expect(() => impliedUpside({ ...base, medianTarget })).toThrow(
        RangeError,
      );
    }
  });

  it("throws on a missing/invalid analyst count instead of silently disqualifying", () => {
    for (const numAnalysts of [Number.NaN, -1, 2.5]) {
      expect(() => impliedUpside({ ...base, numAnalysts })).toThrow(RangeError);
    }
  });

  it("throws on an invalid gate", () => {
    for (const minAnalysts of [Number.NaN, -1, 2.5]) {
      expect(() => impliedUpside({ ...base, minAnalysts })).toThrow(RangeError);
    }
  });
});
