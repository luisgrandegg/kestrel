import { describe, expect, it } from "vitest";
import { daysToEvent } from "./daysToEvent.js";

describe("daysToEvent — MVP.md §5.3 event proximity", () => {
  it("is 0 for an event on the as-of date itself", () => {
    expect(daysToEvent("2026-07-31", "2026-07-31")).toBe(0);
  });

  it("counts calendar days, not trading days", () => {
    // 2026-08-14 is 14 calendar days after 2026-07-31, weekends included.
    expect(daysToEvent("2026-08-14", "2026-07-31")).toBe(14);
    expect(daysToEvent("2026-08-01", "2026-07-31")).toBe(1);
  });

  it("crosses month, year, and leap-day boundaries exactly", () => {
    expect(daysToEvent("2027-01-01", "2026-12-31")).toBe(1);
    // 2028 is a leap year: February has 29 days.
    expect(daysToEvent("2028-03-01", "2028-02-28")).toBe(2);
    expect(daysToEvent("2028-02-29", "2028-02-28")).toBe(1);
  });

  it("a past event yields a negative count — the caller's 0 <= bound excludes it", () => {
    expect(daysToEvent("2026-07-30", "2026-07-31")).toBe(-1);
    expect(daysToEvent("2025-07-31", "2026-07-31")).toBe(-365);
  });

  it("rejects malformed and impossible dates loudly", () => {
    expect(() => daysToEvent("2026-8-1", "2026-07-31")).toThrow(RangeError);
    expect(() => daysToEvent("2026-08-01", "2026-7-31")).toThrow(RangeError);
    // Well-formed but not a real calendar date: must not silently roll over
    // into March (V8's ISO parsing would).
    expect(() => daysToEvent("2026-02-30", "2026-02-01")).toThrow(RangeError);
    // Feb 29 in a non-leap year.
    expect(() => daysToEvent("2026-02-29", "2026-02-01")).toThrow(RangeError);
  });

  it("years below 0100 are real dates — no two-digit-year rule", () => {
    expect(daysToEvent("0026-08-14", "0026-07-31")).toBe(14);
  });
});
