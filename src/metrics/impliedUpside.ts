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

  if (!Number.isFinite(latestClose) || latestClose <= 0) {
    throw new RangeError(
      `latestClose must be a positive finite price, got: ${latestClose}`,
    );
  }
  if (!Number.isFinite(medianTarget) || medianTarget <= 0) {
    throw new RangeError(
      `medianTarget must be a positive finite price, got: ${medianTarget}`,
    );
  }
  if (!Number.isInteger(numAnalysts) || numAnalysts < 0) {
    throw new RangeError(
      `numAnalysts must be a non-negative integer, got: ${numAnalysts}`,
    );
  }
  if (!Number.isInteger(minAnalysts) || minAnalysts < 0) {
    throw new RangeError(
      `minAnalysts must be a non-negative integer, got: ${minAnalysts}`,
    );
  }

  if (numAnalysts < minAnalysts) {
    return { qualified: false, reason: "insufficient-analysts" };
  }

  return {
    qualified: true,
    impliedUpside: (medianTarget - latestClose) / latestClose,
  };
}
