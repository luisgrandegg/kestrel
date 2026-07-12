import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AnalystSnapshot,
  CAPABILITIES,
  type Capability,
  type DailyClose,
  type DividendSnapshot,
  type EarningsSnapshot,
  INSTRUMENT_STATES,
  type InstrumentState,
} from "./index.js";

describe("shared types", () => {
  it("exposes exactly the four MVP capabilities", () => {
    expect(CAPABILITIES).toEqual([
      "closes",
      "analystTargets",
      "earningsCalendar",
      "dividendCalendar",
    ]);
    expectTypeOf<Capability>().toEqualTypeOf<
      "closes" | "analystTargets" | "earningsCalendar" | "dividendCalendar"
    >();
  });

  it("exposes exactly the four lifecycle states", () => {
    expect(INSTRUMENT_STATES).toEqual([
      "pending",
      "backfilling",
      "ready",
      "error",
    ]);
    expectTypeOf<InstrumentState>().toEqualTypeOf<
      "pending" | "backfilling" | "ready" | "error"
    >();
  });

  it("DTO shapes mirror the storage schema fields", () => {
    expectTypeOf<DailyClose>().toEqualTypeOf<{
      ticker: string;
      date: string;
      close: number;
    }>();
    expectTypeOf<AnalystSnapshot>().toEqualTypeOf<{
      ticker: string;
      asOf: string;
      medianTarget: number;
      numAnalysts: number;
    }>();
    expectTypeOf<EarningsSnapshot>().toEqualTypeOf<{
      ticker: string;
      asOf: string;
      nextEarningsDate: string | null;
    }>();
    expectTypeOf<DividendSnapshot>().toEqualTypeOf<{
      ticker: string;
      asOf: string;
      nextExDivDate: string | null;
    }>();
  });
});
