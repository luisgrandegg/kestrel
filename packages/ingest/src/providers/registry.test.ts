import type {
  AnalystSnapshot,
  Capability,
  DailyClose,
  DividendSnapshot,
  EarningsSnapshot,
} from "@kestrel/core/types";
import { describe, expect, it } from "vitest";
import { CAPABILITY_METHODS, type Provider } from "./provider.js";
import { ProviderRegistry } from "./registry.js";

/**
 * Contract tests for the capability registry (backlog item 009) —
 * CONSTITUTION.md §2.1 / §5: providers advertise, screens require, the
 * registry resolves; a screen with an unserved capability is reported
 * disabled with the missing capability named.
 */

const fetches = {
  getCloses: () => Promise.resolve([] as DailyClose[]),
  getInstrumentInfo: () => Promise.resolve({ ticker: "X", currency: "USD" }),
  getAnalystTargets: () => Promise.resolve({} as AnalystSnapshot),
  getNextEarnings: () => Promise.resolve({} as EarningsSnapshot),
  getNextExDividend: () => Promise.resolve({} as DividendSnapshot),
};

/** A fake implementing exactly the methods its advertised capabilities require
 * (a capability may require several — e.g. `closes` needs getCloses AND
 * getInstrumentInfo, ADR-0012). */
const fake = (id: string, ...capabilities: Capability[]): Provider => ({
  id,
  capabilities: new Set(capabilities),
  ...Object.fromEntries(
    capabilities.flatMap((c) =>
      CAPABILITY_METHODS[c].map((m) => [m, fetches[m]]),
    ),
  ),
});

describe("ProviderRegistry — capability resolution", () => {
  it("maps a capability to the providers advertising it, in registration order", () => {
    const primary = fake("primary", "closes", "analystTargets");
    const backup = fake("backup", "closes");
    const registry = new ProviderRegistry([primary, backup]);
    expect(registry.providersFor("closes").map((p) => p.id)).toEqual([
      "primary",
      "backup",
    ]);
    expect(registry.providersFor("analystTargets").map((p) => p.id)).toEqual([
      "primary",
    ]);
    expect(registry.providersFor("earningsCalendar")).toEqual([]);
  });

  it("one provider may serve many capabilities; a capability may be served by many providers", () => {
    const all = fake(
      "all",
      "closes",
      "analystTargets",
      "earningsCalendar",
      "dividendCalendar",
    );
    const registry = new ProviderRegistry([all, fake("prices-only", "closes")]);
    expect(registry.isServed("closes")).toBe(true);
    expect(registry.isServed("dividendCalendar")).toBe(true);
    expect(registry.providersFor("closes")).toHaveLength(2);
  });
});

describe("ProviderRegistry — screen resolution (guardrail 4)", () => {
  it("enables a screen whose required capabilities are all served", () => {
    const registry = new ProviderRegistry([
      fake("full-service", "closes", "analystTargets"),
    ]);
    expect(registry.resolveScreen(["closes", "analystTargets"])).toEqual({
      enabled: true,
    });
  });

  it("disables a screen with an unserved capability and names every missing one", () => {
    const registry = new ProviderRegistry([fake("prices-only", "closes")]);
    expect(
      registry.resolveScreen(["closes", "analystTargets", "earningsCalendar"]),
    ).toEqual({
      enabled: false,
      missing: ["analystTargets", "earningsCalendar"],
    });
  });

  it("an empty registry disables everything, naming all requirements", () => {
    const registry = new ProviderRegistry([]);
    expect(registry.resolveScreen(["closes"])).toEqual({
      enabled: false,
      missing: ["closes"],
    });
  });
});

describe("ProviderRegistry — fail-loud registration", () => {
  it("rejects a provider advertising a capability it does not implement", () => {
    const dishonest: Provider = {
      id: "dishonest",
      capabilities: new Set<Capability>(["closes"]),
      // no getCloses
    };
    expect(() => new ProviderRegistry([dishonest])).toThrow(
      /"dishonest" advertises "closes" but does not implement getCloses/,
    );
  });

  it("rejects a closes provider missing the required currency surface (ADR-0012)", () => {
    // `closes` requires BOTH getCloses and getInstrumentInfo: a provider that
    // cannot report currency fails loud at registration, never silently.
    const pricesOnly: Provider = {
      id: "no-currency",
      capabilities: new Set<Capability>(["closes"]),
      getCloses: () => Promise.resolve([]),
      // no getInstrumentInfo
    };
    expect(() => new ProviderRegistry([pricesOnly])).toThrow(
      /"no-currency" advertises "closes" but does not implement getInstrumentInfo/,
    );
  });

  it("rejects duplicate provider ids", () => {
    expect(
      () =>
        new ProviderRegistry([fake("dup", "closes"), fake("dup", "closes")]),
    ).toThrow(/Duplicate provider id: "dup"/);
  });

  it("registration order is priority order, unaffected by capability sets", () => {
    const a = fake("a", "closes");
    const b = fake("b", "closes", "analystTargets");
    const c = fake("c", "closes");
    const registry = new ProviderRegistry([b, c, a]);
    expect(registry.providersFor("closes").map((p) => p.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});
