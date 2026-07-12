import { assertNonNegativeInteger, assertPositiveFinite } from "./guards.js";

/**
 * Implied-upside metric (backlog item 007) — MVP.md §5.1.
 *
 * impliedUpside = (medianTarget − latestClose) / latestClose
 *
 * Includes the analyst quality gate: an instrument whose analyst count is
 * below the configured minimum does not qualify, in any screen — the result
 * says so explicitly rather than producing a number that looks usable.
 *
 * Pure function over values the caller reads from storage: no I/O, no clock
 * (CONSTITUTION.md §3.2). `minAnalysts` comes from config — never hardcoded.
 */

export interface ImpliedUpsideInput {
  /** Latest analyst median price target, native currency. */
  medianTarget: number;
  /** Most recent stored close, native currency. */
  latestClose: number;
  /** Analyst count behind the target. */
  numAnalysts: number;
  /** Quality gate from config (`minAnalysts`). */
  minAnalysts: number;
}

export type ImpliedUpsideResult =
  | { readonly qualified: true; readonly impliedUpside: number }
  | { readonly qualified: false; readonly reason: "insufficient-analysts" };

export function impliedUpside(input: ImpliedUpsideInput): ImpliedUpsideResult {
  const { medianTarget, latestClose, numAnalysts, minAnalysts } = input;

  assertPositiveFinite("latestClose", latestClose);
  assertPositiveFinite("medianTarget", medianTarget);
  assertNonNegativeInteger("numAnalysts", numAnalysts);
  assertNonNegativeInteger("minAnalysts", minAnalysts);

  if (numAnalysts < minAnalysts) {
    return { qualified: false, reason: "insufficient-analysts" };
  }

  const upside = (medianTarget - latestClose) / latestClose;
  // A near-zero (e.g. subnormal) close passes the positive-finite guard but
  // can overflow the ratio — never hand a non-finite "qualified" number to
  // the screens (CONSTITUTION.md §5). No epsilon: finiteness needs none.
  if (!Number.isFinite(upside)) {
    throw new RangeError(
      `implied upside is not finite (medianTarget=${medianTarget}, latestClose=${latestClose})`,
    );
  }

  return { qualified: true, impliedUpside: upside };
}
