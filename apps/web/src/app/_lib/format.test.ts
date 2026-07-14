import { describe, expect, it } from "vitest";
import { money, percent } from "./format";

/** Pins the §8 dashboard number formats. */
describe("dashboard formatters", () => {
  it("renders implied upside as a one-decimal percentage", () => {
    expect(percent(0.25)).toBe("25.0%");
    expect(percent(0.2)).toBe("20.0%");
    expect(percent(0.1234)).toBe("12.3%");
  });

  it("renders money as value + native currency", () => {
    expect(money(142.5, "USD")).toBe("142.50 USD");
    expect(money(114, "EUR")).toBe("114.00 EUR");
  });

  it("renders an explicit ? when no provider has reported a currency", () => {
    expect(money(142.5, null)).toBe("142.50 ?");
  });
});
