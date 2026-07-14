import type { InstrumentSnapshot } from "../screens/screen.js";

/**
 * Test-support baseline snapshot: ACME/USD as of 2026-07-31, close 100,
 * median target 130 (exactly 30% implied upside), 8 analysts, no scheduled
 * events. Shared by screen tests so the fixture skeleton cannot drift
 * between files; each test overrides only what it exercises. Test-only
 * code, excluded from the dependency cruise.
 */
export const instrumentSnapshot = (
  overrides: Partial<InstrumentSnapshot> = {},
): InstrumentSnapshot => ({
  ticker: "ACME",
  currency: "USD",
  asOf: "2026-07-31",
  latestClose: { ticker: "ACME", date: "2026-07-31", close: 100 },
  analyst: {
    ticker: "ACME",
    asOf: "2026-07-31",
    medianTarget: 130,
    numAnalysts: 8,
  },
  earnings: null,
  dividend: null,
  closes: [{ ticker: "ACME", date: "2026-07-31", close: 100 }],
  ...overrides,
});
