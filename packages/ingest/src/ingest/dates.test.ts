import { describe, expect, it } from "vitest";
import { addDays } from "./dates.js";

describe("addDays — strict UTC date arithmetic", () => {
  it("adds and subtracts calendar days across month and year boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
  });

  it("rejects impossible dates instead of silently rolling them over", () => {
    // V8's ISO parsing maps 2026-02-30 to March 2; a cursor built from a
    // poisoned date must fail loud, not shift the fetch window.
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => addDays("2026-2-1", 1)).toThrow(RangeError);
  });

  it("rejects fractional day counts", () => {
    expect(() => addDays("2026-07-31", 0.5)).toThrow(RangeError);
  });
});
