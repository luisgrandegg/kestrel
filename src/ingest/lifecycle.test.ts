import { describe, expect, it } from "vitest";
import {
  promoteWhenCovered,
  recordFailure,
  startBackfill,
} from "./lifecycle.js";

describe("lifecycle — pending → backfilling → ready (MVP.md §7)", () => {
  it("startBackfill moves pending to backfilling and leaves other states alone", () => {
    expect(startBackfill("pending")).toBe("backfilling");
    expect(startBackfill("backfilling")).toBe("backfilling");
    expect(startBackfill("ready")).toBe("ready");
    expect(startBackfill("error")).toBe("error");
  });

  it("promotes to ready exactly when stored history covers the lookback", () => {
    expect(promoteWhenCovered("backfilling", 62, 63)).toBe("backfilling");
    expect(promoteWhenCovered("backfilling", 63, 63)).toBe("ready");
    expect(promoteWhenCovered("backfilling", 300, 63)).toBe("ready");
    // A pending instrument whose history already covers (e.g. re-synced
    // after a watchlist re-add) promotes directly.
    expect(promoteWhenCovered("pending", 63, 63)).toBe("ready");
  });

  it("a partial backfill is a valid state, not an error", () => {
    expect(promoteWhenCovered("backfilling", 10, 63)).toBe("backfilling");
  });

  it("never demotes ready or resurrects error", () => {
    expect(promoteWhenCovered("ready", 0, 63)).toBe("ready");
    expect(promoteWhenCovered("error", 300, 63)).toBe("error");
  });

  it("validates its numeric inputs loudly", () => {
    expect(() => promoteWhenCovered("pending", -1, 63)).toThrow(RangeError);
    expect(() => promoteWhenCovered("pending", 2.5, 63)).toThrow(RangeError);
    expect(() => promoteWhenCovered("pending", 10, 1)).toThrow(RangeError);
  });
});

describe("lifecycle — error on repeated adapter failure", () => {
  it("marks error at the configured threshold, not before", () => {
    expect(recordFailure("backfilling", 1, 3)).toBe("backfilling");
    expect(recordFailure("backfilling", 2, 3)).toBe("backfilling");
    expect(recordFailure("backfilling", 3, 3)).toBe("error");
    expect(recordFailure("ready", 3, 3)).toBe("error");
  });

  it("the threshold is a parameter from config, not a constant", () => {
    expect(recordFailure("ready", 1, 1)).toBe("error");
    expect(recordFailure("ready", 4, 5)).toBe("ready");
  });

  it("validates counts loudly", () => {
    expect(() => recordFailure("ready", 0, 3)).toThrow(RangeError);
    expect(() => recordFailure("ready", 1, 0)).toThrow(RangeError);
    expect(() => recordFailure("ready", 1.5, 3)).toThrow(RangeError);
  });
});
