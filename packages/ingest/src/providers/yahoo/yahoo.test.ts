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

  it("drops an out-of-window far-east bar dated to+1 (does NOT throw future-dated)", async () => {
    // Auckland (UTC+12 in July): the session that opens 2026-07-14T22:00Z is
    // exchange-local 2026-07-15 — one day AHEAD of the run's UTC `to`/today
    // (2026-07-14). The +1-day period2 pad admits its instant, so it must be
    // dropped as out-of-window, NOT thrown as future-dated (the bug that
    // poisoned every east-of-UTC ticker on every run).
    chart.mockResolvedValue(
      chartResult(
        [
          bar("2026-07-13T22:00:00Z", 40), // Auckland 2026-07-14 — in window
          bar("2026-07-14T22:00:00Z", 41), // Auckland 2026-07-15 — to+1, drop
        ],
        { exchangeTimezoneName: "Pacific/Auckland", currency: "NZD" },
      ),
    );
    const closes = await provider.getCloses(
      "AIR.NZ",
      "2026-07-10",
      "2026-07-14",
    );
    expect(closes).toEqual([
      { ticker: "AIR.NZ", date: "2026-07-14", close: 40 },
    ]);
  });

  it("keeps the from-day bar for a far-east exchange (period1 padded a UTC day)", async () => {
    // Auckland from-day 2026-07-13 opens 2026-07-12T22:00Z — before period1's
    // UTC midnight. The adapter pads period1 back a UTC day so Yahoo returns
    // it, and the exchange-local window filter keeps it (date == from).
    chart.mockResolvedValue(
      chartResult([bar("2026-07-12T22:00:00Z", 40)], {
        exchangeTimezoneName: "Pacific/Auckland",
        currency: "NZD",
      }),
    );
    const closes = await provider.getCloses(
      "AIR.NZ",
      "2026-07-13",
      "2026-07-14",
    );
    expect(closes).toEqual([
      { ticker: "AIR.NZ", date: "2026-07-13", close: 40 },
    ]);
    // The request itself pads period1 back one UTC day (2026-07-12), not `from`.
    const opts = chart.mock.calls[0]?.[1] as { period1: Date };
    expect(opts.period1.toISOString()).toBe("2026-07-12T00:00:00.000Z");
  });

  it("throws future-dated only as a backstop when the caller requests `to` beyond today", async () => {
    // Normal runs pass to == today, so the window filter already excludes
    // future bars; this guards the caller-bug path (to > today).
    chart.mockResolvedValue(
      chartResult([
        bar("2026-07-10T17:00:00Z", 110),
        bar("2026-07-15T17:00:00Z", 120), // within [from, to] but after TODAY
      ]),
    );
    await expect(
      provider.getCloses("ACME", "2026-07-10", "2026-07-16"),
    ).rejects.toThrow(/ACME.*future-dated close 2026-07-15/);
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

  it("returns null (not a numAnalysts:0 snapshot) when a target has no analyst count", async () => {
    // A median target with no analyst count behind it is incoherent — treat
    // it as no usable reading (null), never emit numAnalysts: 0.
    quoteSummary.mockResolvedValue({
      financialData: { targetMedianPrice: 150 }, // count absent
    });
    expect(await provider.getAnalystTargets("ACME")).toBeNull();
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
