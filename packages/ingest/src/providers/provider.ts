import type {
  AnalystSnapshot,
  Capability,
  DailyClose,
  DividendSnapshot,
  EarningsSnapshot,
  IsoDate,
} from "@kestrel/core/types";

/**
 * Provider contract (backlog item 009) — MVP.md §3, CONSTITUTION.md §2.1.
 *
 * A provider advertises the capabilities it can serve and knows nothing
 * about screens. Each advertised capability must be backed by its fetch
 * method — the registry enforces that at registration (fail loud, never at
 * call time three stages downstream).
 */
export interface Provider {
  id: string;
  capabilities: ReadonlySet<Capability>;
  /**
   * Daily closes for calendar dates in [from, to] — BOTH bounds inclusive,
   * matching Repository.getCloses. Adapters must normalize provider quirks
   * (e.g. an exclusive end timestamp) to this contract, or every daily
   * incremental fetch silently runs one trading day stale.
   *
   * A partial return (provider cap, pagination limit) must be the OLDEST
   * contiguous slice of the requested window — never the newest: ingestion
   * resumes from the latest stored date, so a dropped older span would
   * become a permanent hole in append-only storage. Adapters paginate
   * oldest-first.
   */
  getCloses?(ticker: string, from: IsoDate, to: IsoDate): Promise<DailyClose[]>;
  /**
   * Native trading currency of the instrument. Required by the `closes`
   * capability (ADR-0012): currency travels with the price series, and
   * ingestion copies it to `instruments.currency` (copy only, never
   * compute). A provider serving `closes` must back this or fail loud at
   * registration.
   */
  getInstrumentInfo?(
    ticker: string,
  ): Promise<{ ticker: string; currency: string }>;
  /**
   * `null` when the provider CLEARLY reports no analyst coverage (ADR-0012,
   * decision 2): ingestion then writes no snapshot but still stamps the
   * metadata sync, so an uncovered ticker is not refetched before its TTL.
   * A malformed response (coverage reported but no usable target) throws at
   * the adapter edge instead.
   */
  getAnalystTargets?(ticker: string): Promise<AnalystSnapshot | null>;
  getNextEarnings?(ticker: string): Promise<EarningsSnapshot>;
  getNextExDividend?(ticker: string): Promise<DividendSnapshot>;
}

/** A Provider fetch method name. */
export type ProviderMethod =
  | "getCloses"
  | "getInstrumentInfo"
  | "getAnalystTargets"
  | "getNextEarnings"
  | "getNextExDividend";

/**
 * The fetch method(s) that must back each advertised capability. A
 * capability may require several methods: `closes` requires both the price
 * series (`getCloses`) and the instrument currency that travels with it
 * (`getInstrumentInfo`, ADR-0012 decision 3). The registry enforces every
 * listed method is implemented at registration (fail loud).
 */
export const CAPABILITY_METHODS = {
  closes: ["getCloses", "getInstrumentInfo"],
  analystTargets: ["getAnalystTargets"],
  earningsCalendar: ["getNextEarnings"],
  dividendCalendar: ["getNextExDividend"],
} as const satisfies Record<Capability, readonly ProviderMethod[]>;
