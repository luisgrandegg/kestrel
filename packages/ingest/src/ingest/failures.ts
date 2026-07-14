import type { KestrelConfig } from "@kestrel/core/config";
import type { StorageRepository } from "@kestrel/core/storage/port";
import type { InstrumentState } from "@kestrel/core/types";
import { recordFailure } from "./lifecycle.js";
import { ProviderCallError } from "./throttle.js";

/**
 * Shared failure attribution for the ingestion runners (MVP §7): only
 * tagged provider failures feed the persistent streak that demotes to
 * sticky `error` — anything else rethrows and aborts the run loudly,
 * because a local storage/logic failure is not the adapter's fault.
 *
 * Lives here (not lifecycle.ts, which stays pure) so backfill and daily
 * refresh can never drift on this invariant.
 */
export async function chargeProviderFailure(
  repo: StorageRepository,
  config: KestrelConfig,
  state: InstrumentState,
  ticker: string,
  error: unknown,
): Promise<{ message: string; errored: boolean }> {
  if (!(error instanceof ProviderCallError)) {
    throw error;
  }
  const failures = await repo.incrementFailures(ticker);
  const next = recordFailure(
    state,
    failures,
    config.ingestion.maxConsecutiveFailures,
  );
  if (next === "error") {
    await repo.setInstrumentState(ticker, "error");
  }
  return { message: error.message, errored: next === "error" };
}
