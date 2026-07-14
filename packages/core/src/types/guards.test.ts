import { describe, expect, it } from "vitest";
import { utcIsoDate } from "./guards.js";

describe("utcIsoDate — the daily run's dedupe key", () => {
  it("converts an instant to its UTC calendar date, not the local one", () => {
    // 03:30 IST on the 14th is still 22:00 UTC on the 13th.
    expect(utcIsoDate(new Date("2026-07-14T03:30:00+05:30"))).toBe(
      "2026-07-13",
    );
    // One second before UTC midnight stays on the earlier date...
    expect(utcIsoDate(new Date("2026-07-13T23:59:59Z"))).toBe("2026-07-13");
    // ...and midnight itself rolls over.
    expect(utcIsoDate(new Date("2026-07-14T00:00:00Z"))).toBe("2026-07-14");
  });

  it("fails loud on an invalid Date instead of producing a bogus key", () => {
    expect(() => utcIsoDate(new Date("nonsense"))).toThrow(RangeError);
  });
});
