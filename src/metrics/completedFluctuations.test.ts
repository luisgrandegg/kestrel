import { describe, expect, it } from "vitest";
import { countCompletedFluctuations } from "./completedFluctuations.js";

/**
 * Acceptance tests pinned from MVP.md §5.2 (backlog item 005), written
 * before the implementation per CLAUDE.md M1 and CONSTITUTION.md §5.
 * The expected values are verbatim from the spec and must never be edited
 * to fit an implementation.
 */

const THETA = 0.1;

describe("countCompletedFluctuations — MVP.md §5.2 acceptance table (θ = 0.10)", () => {
  it("[100,112,98,113,99,114] → 4: four confirmed legs; trailing up-leg to 114 excluded", () => {
    expect(countCompletedFluctuations([100, 112, 98, 113, 99, 114], THETA)).toBe(4);
  });

  it("counts only completed legs: the trailing +15% leg (99 → 114) is NOT counted, because no ≥θ reversal confirms it", () => {
    // The canonical confirm-on-reversal case. Dropping the trailing leg
    // changes nothing: it was pending, not counted.
    expect(countCompletedFluctuations([100, 112, 98, 113, 99], THETA)).toBe(
      countCompletedFluctuations([100, 112, 98, 113, 99, 114], THETA) - 1,
    );
  });

  it("[100,110,121,133] → 0: monotonic, never reverses ≥10%, nothing confirmed", () => {
    expect(countCompletedFluctuations([100, 110, 121, 133], THETA)).toBe(0);
  });

  it("[100,140,138,136] → 0: one big up-move, no ≥10% reversal, not yet completed", () => {
    expect(countCompletedFluctuations([100, 140, 138, 136], THETA)).toBe(0);
  });

  it("[100,88,101,89,102,90,103] → 5: five confirmed alternating legs; trailing up-leg excluded", () => {
    expect(
      countCompletedFluctuations([100, 88, 101, 89, 102, 90, 103], THETA),
    ).toBe(5);
  });

  it("[100,103,97,104] → 0: swings under 10% never confirm", () => {
    expect(countCompletedFluctuations([100, 103, 97, 104], THETA)).toBe(0);
  });
});

describe("countCompletedFluctuations — θ is a parameter, not a constant", () => {
  it("the same series confirms legs under a smaller θ", () => {
    // Under θ = 3% the sub-10% swings of the last acceptance case confirm:
    // 100→103 (+3%) confirmed by 103→97 (−5.8%), confirmed by 97→104 (+7.2%).
    expect(countCompletedFluctuations([100, 103, 97, 104], 0.03)).toBe(2);
  });

  it("a larger θ confirms nothing on the canonical series", () => {
    expect(countCompletedFluctuations([100, 112, 98, 113, 99, 114], 0.2)).toBe(
      0,
    );
  });
});

describe("countCompletedFluctuations — edge cases", () => {
  it("fewer than 2 closes → 0", () => {
    expect(countCompletedFluctuations([], THETA)).toBe(0);
    expect(countCompletedFluctuations([100], THETA)).toBe(0);
  });

  it("throws on zero or negative closes instead of returning a silent wrong answer", () => {
    expect(() => countCompletedFluctuations([100, 0, 110], THETA)).toThrow(
      RangeError,
    );
    expect(() => countCompletedFluctuations([-5, 100], THETA)).toThrow(
      RangeError,
    );
  });

  it("throws on non-finite closes", () => {
    expect(() =>
      countCompletedFluctuations([100, Number.NaN], THETA),
    ).toThrow(RangeError);
    expect(() =>
      countCompletedFluctuations([100, Number.POSITIVE_INFINITY], THETA),
    ).toThrow(RangeError);
  });

  it("throws on an invalid threshold", () => {
    expect(() => countCompletedFluctuations([100, 110], 0)).toThrow(RangeError);
    expect(() => countCompletedFluctuations([100, 110], -0.1)).toThrow(
      RangeError,
    );
    expect(() => countCompletedFluctuations([100, 110], Number.NaN)).toThrow(
      RangeError,
    );
  });

  it("a reversal exactly equal to θ confirms (≥, not >)", () => {
    // 100 → 120 (+20% up-leg), 120 → 108 is exactly −10%: confirms the up-leg.
    expect(countCompletedFluctuations([100, 120, 108], THETA)).toBe(1);
  });
});
