import type {
  AnalystSnapshot,
  Capability,
  DailyClose,
  DividendSnapshot,
  EarningsSnapshot,
  IsoDate,
} from "../types/index.js";

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
   */
  getCloses?(ticker: string, from: IsoDate, to: IsoDate): Promise<DailyClose[]>;
  getAnalystTargets?(ticker: string): Promise<AnalystSnapshot>;
  getNextEarnings?(ticker: string): Promise<EarningsSnapshot>;
  getNextExDividend?(ticker: string): Promise<DividendSnapshot>;
}

/** The fetch method that must back each advertised capability. */
export const CAPABILITY_METHODS = {
  closes: "getCloses",
  analystTargets: "getAnalystTargets",
  earningsCalendar: "getNextEarnings",
  dividendCalendar: "getNextExDividend",
} as const satisfies Record<
  Capability,
  "getCloses" | "getAnalystTargets" | "getNextEarnings" | "getNextExDividend"
>;
