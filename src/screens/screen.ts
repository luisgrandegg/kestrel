import type { KestrelConfig } from "../config/index.js";
import type {
  AnalystSnapshot,
  Capability,
  DailyClose,
  DividendSnapshot,
  EarningsSnapshot,
  IsoDate,
} from "../types/index.js";

/**
 * Screen framework (backlog item 014) — CONSTITUTION.md §2.1–2.2.
 *
 * A screen is a declarative, deterministic predicate over stored data. It
 * performs no I/O and never touches a provider: the composition root
 * (src/app/) reads storage into an InstrumentSnapshot per ticker, consults
 * the registry to disable screens with unmet capabilities, and hands
 * enabled screens their inputs.
 */

/** Everything a screen may look at for one instrument, as of one date. */
export interface InstrumentSnapshot {
  ticker: string;
  /** Native currency; null until a provider reports it (open question 3 on item 010). */
  currency: string | null;
  /** The evaluation's as-of date — no data newer than this is present. */
  asOf: IsoDate;
  /** Most recent stored close on or before asOf. */
  latestClose: DailyClose;
  /** Latest metadata snapshots on or before asOf; null when never observed. */
  analyst: AnalystSnapshot | null;
  earnings: EarningsSnapshot | null;
  dividend: DividendSnapshot | null;
  /** Trailing lookback window of closes (trading-day rows), chronological. */
  closes: readonly DailyClose[];
}

export interface Screen<Match> {
  id: string;
  /** Capabilities that must be served for this screen to run (MVP §3). */
  requiredCapabilities: readonly Capability[];
  /**
   * The predicate: a match (with its supporting numbers) or null.
   * Missing inputs (e.g. no analyst snapshot yet) mean "no match" — never
   * a fabricated value (guardrail 4).
   */
  evaluate(snapshot: InstrumentSnapshot, config: KestrelConfig): Match | null;
}
