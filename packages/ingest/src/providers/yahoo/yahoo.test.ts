import type { IsoDate } from "@kestrel/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the Yahoo adapter (backlog item 010, ADR-0012). No live
 * network: yahoo-finance2 is mocked with recorded-shape responses, so these
 * pin the NORMALIZATION and FAIL-LOUD behavior — the adapter's whole job — not
 * Yahoo's uptime. Every acceptance criterion of item 010 is covered here.
 */

vi.mock("yahoo-finance2", () => ({
  default: { chart: vi.fn(), quoteSummary: vi.fn() },
}));

// Imported after the mock factory (hoisted) so these are the mocked fns.
import yahooFinance from "yahoo-finance2";
import { YahooProvider } from "./yahoo.js";

const chart = vi.mocked(
  yahooFinance.chart as unknown as (...args: unknown[]) => Promise<unknown>,
);
const quoteSummary = vi.mocked(
  yahooFinance.quoteSummary as unknown as (
    ...args: unknown[]
  ) => Promise<unknown>,
);

const TODAY: IsoDate = "2026-07-14";
const provider = new YahooProvider({ today: () => TODAY });

/** A chart bar at a given UTC instant with a given close. */
const bar = (iso: string, close: number | null) => ({
  date: new Date(iso),
  close,
});

const chartResult = (
  quotes: ReturnType<typeof bar>[],
  meta: { exchangeTimezoneName?: string; currency?: string } = {
    exchangeTimezoneName: "America/New_York",
    currency: "USD",
  },
) => ({ meta, quotes });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("YahooProvider — shape", () => {
  it("advertises all four capabilities under a stable id", () => {
    expect(provider.id).toBe("yahoo");
    expect([...provider.capabilities].sort()).toEqual([
      "analystTargets",
      "closes",
      "dividendCalendar",
      "earningsCalendar",
    ]);
  });
});

describe("YahooProvider.getCloses", () => {
  it("normalizes a daily series: ticker echoed, zero-padded ISO dates, oldest-first", async () => {
    // Deliberately out of order and mid-afternoon (NY market hours) so UTC and
    // exchange-local dates coincide for this baseline case.
    chart.mockResolvedValue(
      chartResult([
        bar("2026-07-13T17:00:00Z", 113),
        bar("2026-07-10T17:00:00Z", 110),
        bar("2026-07-14T17:00:00Z", 114),
      ]),
    );

    const closes = await provider.getCloses("ACME", "2026-07-10", "2026-07-14");
    expect(closes).toEqual([
      { ticker: "ACME", date: "2026-07-10", close: 110 },
      { ticker: "ACME", date: "2026-07-13", close: 113 },
      { ticker: "ACME", date: "2026-07-14", close: 114 },
    ]);
  });

  it("honors inclusive [from, to]: returns the to-date bar when present", async () => {
    chart.mockResolvedValue(
      chartResult([
        bar("2026-07-10T17:00:00Z", 110),
        bar("2026-07-14T17:00:00Z", 114),
      ]),
    );
    const closes = await provider.getCloses("ACME", "2026-07-10", "2026-07-14");
    expect(closes.at(-1)).toEqual({
      ticker: "ACME",
      date: "2026-07-14",
      close: 114,
    });
  });

  it("dates each bar in the EXCHANGE-local calendar, not UTC-naive", async () => {
    // Sydney is UTC+10: a 23:00Z instant on the 13th is the 14th in Sydney.
    // A UTC-naive adapter would mis-date this bar to 2026-07-13.
    chart.mockResolvedValue(
      chartResult([bar("2026-07-13T23:00:00Z", 50)], {
        exchangeTimezoneName: "Australia/Sydney",
        currency: "AUD",
      }),
    );
    const closes = await provider.getCloses(
      "BHP.AX",
      "2026-07-10",
      "2026-07-14",
    );
    expect(closes).toEqual([
      { ticker: "BHP.AX", date: "2026-07-14", close: 50 },
    ]);
  });

  it("drops null-close (halted) bars as normalization, keeping the rest", async () => {
    chart.mockResolvedValue(
      chartResult([
        bar("2026-07-10T17:00:00Z", 110),
        bar("2026-07-13T17:00:00Z", null),
        bar("2026-07-14T17:00:00Z", 114),
      ]),
    );
    const closes = await provider.getCloses("ACME", "2026-07-10", "2026-07-14");
    expect(closes.map((c) => c.date)).toEqual(["2026-07-10", "2026-07-14"]);
  });

  it("throws on a bar dated after the injected clock, naming the ticker", async () => {
    chart.mockResolvedValue(
      chartResult([
        bar("2026-07-10T17:00:00Z", 110),
        bar("2026-07-16T17:00:00Z", 120), // after TODAY (2026-07-14)
      ]),
    );
    await expect(
      provider.getCloses("ACME", "2026-07-10", "2026-07-14"),
    ).rejects.toThrow(/ACME.*future-dated close 2026-07-16/);
  });

  it("throws on a non-positive close (append-only positivity contract)", async () => {
    chart.mockResolvedValue(chartResult([bar("2026-07-10T17:00:00Z", 0)]));
    await expect(
      provider.getCloses("ACME", "2026-07-10", "2026-07-14"),
    ).rejects.toThrow(/ACME.*non-positive or non-finite close 0/);
  });

  it("throws when chart meta carries no exchange timezone", async () => {
    chart.mockResolvedValue(
      chartResult([bar("2026-07-10T17:00:00Z", 110)], { currency: "USD" }),
    );
    await expect(
      provider.getCloses("ACME", "2026-07-10", "2026-07-14"),
    ).rejects.toThrow(/ACME.*no exchange timezone/);
  });

  it("throws when chart returns no quote array", async () => {
    chart.mockResolvedValue({
      meta: { exchangeTimezoneName: "America/New_York" },
    });
    await expect(
      provider.getCloses("ACME", "2026-07-10", "2026-07-14"),
    ).rejects.toThrow(/ACME.*no quote array/);
  });
});

describe("YahooProvider.getInstrumentInfo", () => {
  it("returns the native currency, echoing the requested ticker", async () => {
    quoteSummary.mockResolvedValue({ price: { currency: "EUR" } });
    expect(await provider.getInstrumentInfo("ASML.AS")).toEqual({
      ticker: "ASML.AS",
      currency: "EUR",
    });
  });

  it("throws when the price module carries no currency", async () => {
    quoteSummary.mockResolvedValue({ price: {} });
    await expect(provider.getInstrumentInfo("ACME")).rejects.toThrow(
      /ACME.*no currency/,
    );
  });
});

describe("YahooProvider.getAnalystTargets", () => {
  it("normalizes median target + analyst count, stamping asOf from the clock", async () => {
    quoteSummary.mockResolvedValue({
      financialData: { targetMedianPrice: 150, numberOfAnalystOpinions: 12 },
    });
    expect(await provider.getAnalystTargets("ACME")).toEqual({
      ticker: "ACME",
      asOf: TODAY,
      medianTarget: 150,
      numAnalysts: 12,
    });
  });

  it("returns null when Yahoo clearly reports no coverage (ADR-0012 decision 2)", async () => {
    quoteSummary.mockResolvedValue({
      financialData: { numberOfAnalystOpinions: 0 },
    });
    expect(await provider.getAnalystTargets("NOCOV")).toBeNull();

    quoteSummary.mockResolvedValue({ financialData: {} }); // count + target absent
    expect(await provider.getAnalystTargets("NOCOV")).toBeNull();
  });

  it("throws when coverage is reported but the target is missing (malformed)", async () => {
    quoteSummary.mockResolvedValue({
      financialData: { numberOfAnalystOpinions: 8 },
    });
    await expect(provider.getAnalystTargets("ACME")).rejects.toThrow(
      /ACME.*8 analyst opinions but no usable median target/,
    );
  });

  it("throws when the financialData module is absent", async () => {
    quoteSummary.mockResolvedValue({});
    await expect(provider.getAnalystTargets("ACME")).rejects.toThrow(
      /ACME.*no financialData/,
    );
  });
});

describe("YahooProvider.getNextEarnings", () => {
  it("picks the earliest scheduled date, stamping asOf and echoing the ticker", async () => {
    quoteSummary.mockResolvedValue({
      calendarEvents: {
        earnings: {
          earningsDate: [
            new Date("2026-08-12T12:00:00Z"),
            new Date("2026-08-07T12:00:00Z"),
          ],
        },
      },
    });
    expect(await provider.getNextEarnings("ACME")).toEqual({
      ticker: "ACME",
      asOf: TODAY,
      nextEarningsDate: "2026-08-07",
    });
  });

  it("returns a null date when none is scheduled", async () => {
    quoteSummary.mockResolvedValue({
      calendarEvents: { earnings: { earningsDate: [] } },
    });
    expect(await provider.getNextEarnings("ACME")).toEqual({
      ticker: "ACME",
      asOf: TODAY,
      nextEarningsDate: null,
    });
  });
});

describe("YahooProvider.getNextExDividend", () => {
  it("reads the ex-dividend date from calendarEvents", async () => {
    quoteSummary.mockResolvedValue({
      calendarEvents: { exDividendDate: new Date("2026-07-20T12:00:00Z") },
    });
    expect(await provider.getNextExDividend("ACME")).toEqual({
      ticker: "ACME",
      asOf: TODAY,
      nextExDivDate: "2026-07-20",
    });
  });

  it("falls back to summaryDetail.exDividendDate (item 010 table)", async () => {
    quoteSummary.mockResolvedValue({
      calendarEvents: {},
      summaryDetail: { exDividendDate: new Date("2026-07-22T12:00:00Z") },
    });
    expect((await provider.getNextExDividend("ACME")).nextExDivDate).toBe(
      "2026-07-22",
    );
  });

  it("returns a null date when neither source has one", async () => {
    quoteSummary.mockResolvedValue({ calendarEvents: {}, summaryDetail: {} });
    expect(await provider.getNextExDividend("ACME")).toEqual({
      ticker: "ACME",
      asOf: TODAY,
      nextExDivDate: null,
    });
  });
});
