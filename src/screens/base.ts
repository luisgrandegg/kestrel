import { impliedUpside } from "../metrics/impliedUpside.js";
import type { InstrumentSnapshot } from "./screen.js";

/**
 * The base predicate shared by all three screens (MVP.md §6):
 *
 *   BASE(ticker) := numAnalysts >= minAnalysts AND impliedUpside >= upsideThreshold
 *
 * `upsideThreshold` is per screen; `minAnalysts` is global — both from
 * config, never hardcoded (guardrail 5).
 */

/** The supporting numbers every matched row carries (MVP.md §8). */
export interface BaseMatch {
  ticker: string;
  /**
   * Native currency of medianTarget/latestClose (§8: shown natively,
   * unconverted). Current instrument metadata, not an as-of observation;
   * null until a provider has reported it.
   */
  currency: string | null;
  impliedUpside: number;
  medianTarget: number;
  latestClose: number;
  numAnalysts: number;
}

/**
 * Evaluate BASE for one instrument. An instrument with no analyst snapshot
 * yet cannot qualify — that is missing data, not a zero (guardrail 4).
 */
export function evaluateBase(
  snapshot: InstrumentSnapshot,
  minAnalysts: number,
  upsideThreshold: number,
): BaseMatch | null {
  if (snapshot.analyst === null) {
    return null;
  }
  const result = impliedUpside({
    medianTarget: snapshot.analyst.medianTarget,
    latestClose: snapshot.latestClose.close,
    numAnalysts: snapshot.analyst.numAnalysts,
    minAnalysts,
  });
  if (!result.qualified || result.impliedUpside < upsideThreshold) {
    return null;
  }
  return {
    ticker: snapshot.ticker,
    currency: snapshot.currency,
    impliedUpside: result.impliedUpside,
    medianTarget: snapshot.analyst.medianTarget,
    latestClose: snapshot.latestClose.close,
    numAnalysts: snapshot.analyst.numAnalysts,
  };
}
