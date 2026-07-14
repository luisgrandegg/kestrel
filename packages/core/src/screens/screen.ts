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
 * (apps/cli/src/app/) reads storage into an InstrumentSnapshot per ticker, consults
 * the registry to disable screens with unmet capabilities, and hands
 * enabled screens their inputs.
 *
 * Screens are CONSTRUCTED from config (a factory binds the screen's own
 * thresholds — its `config.screens.categoryN` slice plus globals like
 * `minAnalysts`) rather than reading the whole config inside `evaluate`.
 * With every screen's default threshold identical, a copy-pasted wrong
 * config path would pass all default-config tests and misbehave only on a
 * user override — binding at construction makes that mistake
 * unrepresentable, and keeps screens blind to unrelated config.
 */

/** Everything a screen may look at for one instrument, as of one date. */
export interface InstrumentSnapshot {
  ticker: string;
  /**
   * Native currency — the instrument's CURRENT metadata column, not an
   * as-of-bounded observation (null until a provider reports it; open
   * question 3 on item 010). Historical evaluations see today's value.
   */
  currency: string | null;
  /** The evaluation's as-of date — no data newer than this is present. */
  asOf: IsoDate;
  /** Most recent stored close on or before asOf. */
  latestClose: DailyClose;
  /** Latest metadata snapshots on or before asOf; null when never observed. */
  analyst: AnalystSnapshot | null;
  earnings: EarningsSnapshot | null;
  dividend: DividendSnapshot | null;
  /**
   * Trailing lookback window of closes (trading-day rows), chronological.
   * Sized by `config.fluctuation.lookbackTradingDays` — the one windowed
   * metric in the MVP; a screen needing a different window must declare it
   * rather than silently widening this one (it would change category 1's
   * fluctuation count).
   */
  closes: readonly DailyClose[];
}

export interface Screen<Match> {
  id: string;
  /** Capabilities that must be served for this screen to run (MVP §3). */
  requiredCapabilities: readonly Capability[];
  /**
   * The predicate: a match (with its supporting numbers) or null. All
   * thresholds are bound at construction — evaluate takes only the data.
   * Missing inputs (e.g. no analyst snapshot yet) mean "no match" — never
   * a fabricated value (guardrail 4).
   */
  evaluate(snapshot: InstrumentSnapshot): Match | null;
}
