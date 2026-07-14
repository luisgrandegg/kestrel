/**
 * Provider-call throttling and failure tagging (MVP.md §7 step 3).
 *
 * One throttle instance covers one RUN — "sleep interCallDelayMs between
 * provider calls throughout" includes the boundary between the daily-refresh
 * and backfill phases, so item 013 passes a single shared instance into
 * both rather than each phase starting an un-delayed first call.
 */

export type Throttle = <T>(call: () => Promise<T>) => Promise<T>;

/**
 * Marks a failure as originating from a provider call (or from validating
 * what it returned). Only these feed the persistent adapter-failure streak
 * (MVP §7 reserves `error` for repeated ADAPTER failure) — local storage or
 * logic errors rethrow untagged and abort the run loudly instead.
 */
export class ProviderCallError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "ProviderCallError";
  }
}

export function makeThrottle(
  sleep: (ms: number) => Promise<void>,
  delayMs: number,
): Throttle {
  let anyCallMade = false;
  return async <T>(call: () => Promise<T>): Promise<T> => {
    if (anyCallMade) {
      await sleep(delayMs);
    }
    anyCallMade = true;
    try {
      return await call();
    } catch (error) {
      throw new ProviderCallError(error);
    }
  };
}
