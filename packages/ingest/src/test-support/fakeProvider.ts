import type { Capability } from "@kestrel/core/types";
import type { Provider } from "../providers/provider.js";

/**
 * Test-support fake: a Provider advertising exactly the given capabilities.
 * Shared by harness/screen tests so capability-resolution fixtures cannot
 * drift between copies. Test-only code: excluded from the dependency
 * cruise (see .dependency-cruiser.cjs) and never imported by src/ modules.
 */
export const providerWith = (...capabilities: Capability[]): Provider => ({
  id: "fake",
  capabilities: new Set(capabilities),
  getCloses: () => Promise.resolve([]),
  // Required alongside getCloses by the `closes` capability (ADR-0012): a
  // provider advertising closes must back the instrument-currency surface.
  getInstrumentInfo: (ticker) => Promise.resolve({ ticker, currency: "USD" }),
  // Return type is AnalystSnapshot | null (ADR-0012 decision 2); this fake
  // reports coverage.
  getAnalystTargets: () =>
    Promise.resolve({
      ticker: "X",
      asOf: "2026-07-10",
      medianTarget: 1,
      numAnalysts: 5,
    }),
  getNextEarnings: () =>
    Promise.resolve({
      ticker: "X",
      asOf: "2026-07-10",
      nextEarningsDate: null,
    }),
  getNextExDividend: () =>
    Promise.resolve({
      ticker: "X",
      asOf: "2026-07-10",
      nextExDivDate: null,
    }),
});
