import type {
  AnalystSnapshot,
  Capability,
  DailyClose,
  DividendSnapshot,
  EarningsSnapshot,
  IsoDate,
} from "@kestrel/core/types";
import {
  assertIntegerAtLeast,
  assertIsoDate,
  assertPositiveFinite,
} from "@kestrel/core/types/guards";
import yahooFinance from "yahoo-finance2";
import type { Provider } from "../provider.js";

/**
 * The one MVP adapter (backlog item 010, ADR-0008 / ADR-0012) — wrapping
 * `yahoo-finance2`, serving all four capabilities plus the instrument
 * currency that travels with `closes`. Every Yahoo-specific field name,
 * endpoint, and quirk lives HERE and nowhere else (CONSTITUTION.md §2.3,
 * guardrail 1, lint-enforced); malformed or partial responses throw at this
 * boundary with the ticker named (guardrail 6), never three stages
 * downstream where an append-only bad row could never be removed.
 *
 * asOf stamping (ADR-0012 decision 1): the adapter reads NO wall clock. The
 * injected `today` — the same run date the composition root passes to
 * ingestion — stamps every snapshot's `asOf`, so a snapshot can never be
 * dated ahead of the run (guardrail 2).
 */

// ---- The narrow slice of yahoo-finance2's decoded shapes we consume. ----
// Confined to this file so the library's field names never escape the
// adapter; the single cast below is the one place the surface is asserted.

interface ChartMeta {
  currency?: string;
  /** IANA zone of the listing exchange, e.g. "America/New_York". */
  exchangeTimezoneName?: string;
}
interface ChartBar {
  /** Bar timestamp (market open of the trading day), as a JS instant. */
  date: Date;
  /** `null` on halted days — dropped as normalization, never fabricated. */
  close: number | null;
}
interface ChartResult {
  meta?: ChartMeta;
  quotes?: ChartBar[];
}
interface FinancialData {
  targetMedianPrice?: number;
  numberOfAnalystOpinions?: number;
}
interface CalendarEvents {
  earnings?: { earningsDate?: Date[] };
  exDividendDate?: Date;
}
interface SummaryDetail {
  exDividendDate?: Date;
}
interface PriceModule {
  currency?: string;
}
interface QuoteSummaryResult {
  financialData?: FinancialData;
  calendarEvents?: CalendarEvents;
  summaryDetail?: SummaryDetail;
  price?: PriceModule;
}

interface YahooClient {
  chart(
    symbol: string,
    opts: {
      period1: IsoDate;
      period2: Date;
      interval: "1d";
      return: "array";
    },
  ): Promise<ChartResult>;
  quoteSummary(
    symbol: string,
    opts: { modules: readonly string[] },
  ): Promise<QuoteSummaryResult>;
}

const yf = yahooFinance as unknown as YahooClient;

/** A fail-loud adapter-boundary error naming the ticker (guardrail 6). */
function malformed(ticker: string, detail: string): Error {
  return new RangeError(`Yahoo response for ${ticker} is malformed: ${detail}`);
}

/**
 * Exchange-local calendar date of an instant via the listing exchange's IANA
 * zone. `en-CA` renders `YYYY-MM-DD` (zero-padded). Converting close
 * timestamps in UTC would mis-date a bar by a day for exchanges east/west of
 * UTC (a Sydney close near midnight lands on the wrong calendar day) — the
 * date is the metric/cursor key, so it must be the exchange-local day.
 */
function exchangeLocalDate(instant: Date, timeZone: string): IsoDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The instant one UTC day after an ISO date — Yahoo's chart `period2` is
 * exclusive of its own day, so pad by one to include the `to`-date bar. */
function nextUtcDay(date: IsoDate): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000);
}

/**
 * UTC calendar date of a day-granularity scheduling instant (earnings,
 * ex-dividend). These are not intraday prices: the exchange-tz conversion is
 * reserved for the close series where it is load-bearing; event dates use UTC,
 * consistent with the pipeline's UTC calendar dates (ADR-0012). Throws on a
 * missing/invalid instant.
 */
function eventDate(ticker: string, instant: unknown): IsoDate {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw malformed(ticker, `calendar event has an invalid date: ${instant}`);
  }
  const iso = instant.toISOString().slice(0, 10);
  assertIsoDate(`event date for ${ticker}`, iso);
  return iso;
}

export class YahooProvider implements Provider {
  readonly id = "yahoo";
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    "closes",
    "analystTargets",
    "earningsCalendar",
    "dividendCalendar",
  ]);

  /** Injected run-date source — the only clock the adapter ever reads. */
  private readonly today: () => IsoDate;

  constructor(deps: { today: () => IsoDate }) {
    this.today = deps.today;
  }

  async getCloses(
    ticker: string,
    from: IsoDate,
    to: IsoDate,
  ): Promise<DailyClose[]> {
    const result = await yf.chart(ticker, {
      period1: from,
      period2: nextUtcDay(to),
      interval: "1d",
      return: "array",
    });
    const timeZone = result?.meta?.exchangeTimezoneName;
    if (typeof timeZone !== "string" || timeZone === "") {
      throw malformed(ticker, "chart meta has no exchange timezone");
    }
    const quotes = result.quotes;
    if (!Array.isArray(quotes)) {
      throw malformed(ticker, "chart returned no quote array");
    }

    const today = this.today();
    const closes: DailyClose[] = [];
    for (const bar of quotes) {
      if (bar === null || bar === undefined) {
        continue;
      }
      // Halted day: drop the null-close bar. This is normalization (the
      // series has no observation for that day), never fabrication.
      if (bar.close === null || bar.close === undefined) {
        continue;
      }
      if (!(bar.date instanceof Date) || Number.isNaN(bar.date.getTime())) {
        throw malformed(ticker, "chart bar has an invalid timestamp");
      }
      const date = exchangeLocalDate(bar.date, timeZone);
      assertIsoDate(`close date for ${ticker}`, date);
      if (!Number.isFinite(bar.close) || bar.close <= 0) {
        throw malformed(
          ticker,
          `non-positive or non-finite close ${bar.close} on ${date}`,
        );
      }
      // No metric may ever see a close dated after the run date.
      if (date > today) {
        throw malformed(
          ticker,
          `future-dated close ${date} is after today ${today}`,
        );
      }
      // Outside the requested inclusive window (e.g. the one-day period2 pad)
      // — legitimately excluded, not a failure.
      if (date < from || date > to) {
        continue;
      }
      closes.push({ ticker, date, close: bar.close });
    }
    // Oldest-first: a capped/partial return is then the oldest contiguous
    // slice, so a resumed backfill never leaves an older hole (Provider
    // contract).
    closes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return closes;
  }

  async getInstrumentInfo(
    ticker: string,
  ): Promise<{ ticker: string; currency: string }> {
    const result = await yf.quoteSummary(ticker, { modules: ["price"] });
    const currency = result?.price?.currency;
    if (typeof currency !== "string" || currency.trim() === "") {
      throw malformed(ticker, "quoteSummary price has no currency");
    }
    return { ticker, currency };
  }

  async getAnalystTargets(ticker: string): Promise<AnalystSnapshot | null> {
    const result = await yf.quoteSummary(ticker, {
      modules: ["financialData"],
    });
    const fd = result?.financialData;
    if (fd === undefined || fd === null) {
      throw malformed(ticker, "quoteSummary returned no financialData");
    }
    const rawTarget = fd.targetMedianPrice;
    const rawCount = fd.numberOfAnalystOpinions;
    const targetUsable =
      typeof rawTarget === "number" &&
      Number.isFinite(rawTarget) &&
      rawTarget > 0;
    const noCoverage =
      rawCount === undefined || rawCount === null || rawCount === 0;
    if (!targetUsable) {
      // ADR-0012 decision 2: Yahoo CLEARLY reports no coverage — no snapshot
      // (ingestion still stamps the metadata sync so it isn't refetched).
      if (noCoverage) {
        return null;
      }
      // Coverage reported but no usable target: malformed — fail loud.
      throw malformed(
        ticker,
        `reports ${rawCount} analyst opinions but no usable median target (${rawTarget})`,
      );
    }
    const count = rawCount ?? 0;
    assertIntegerAtLeast(`numAnalysts for ${ticker}`, count, 0);
    assertPositiveFinite(`medianTarget for ${ticker}`, rawTarget);
    return {
      ticker,
      asOf: this.today(),
      medianTarget: rawTarget,
      numAnalysts: count,
    };
  }

  async getNextEarnings(ticker: string): Promise<EarningsSnapshot> {
    const result = await yf.quoteSummary(ticker, {
      modules: ["calendarEvents"],
    });
    const dates = result?.calendarEvents?.earnings?.earningsDate;
    let nextEarningsDate: IsoDate | null = null;
    if (Array.isArray(dates) && dates.length > 0) {
      // Yahoo reports one or a two-date estimate range; the earliest is the
      // next scheduled report (MVP §6 upcoming-only).
      const earliest = dates.reduce((a, b) => (a <= b ? a : b));
      nextEarningsDate = eventDate(ticker, earliest);
    }
    return { ticker, asOf: this.today(), nextEarningsDate };
  }

  async getNextExDividend(ticker: string): Promise<DividendSnapshot> {
    const result = await yf.quoteSummary(ticker, {
      modules: ["calendarEvents", "summaryDetail"],
    });
    const raw =
      result?.calendarEvents?.exDividendDate ??
      result?.summaryDetail?.exDividendDate;
    const nextExDivDate =
      raw === undefined || raw === null ? null : eventDate(ticker, raw);
    return { ticker, asOf: this.today(), nextExDivDate };
  }
}
