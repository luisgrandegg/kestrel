import type { StorageRepository } from "@kestrel/core/storage/port";
import type { IsoDate } from "@kestrel/core/types";
import type { ProviderRegistry } from "../providers/registry.js";
import type { Throttle } from "./throttle.js";

/**
 * Fetch and store the three metadata snapshots for a ticker — shared by
 * initial bring-up (item 012) and the TTL refresh (item 013).
 *
 * A capability served by no provider is skipped: the registry disables the
 * dependent screens, which is the sanctioned degradation path (guardrail 4)
 * — never fabrication. Stamps `last_metadata_sync` when done.
 */
export async function fetchMetadataSnapshots(
  registry: ProviderRegistry,
  throttle: Throttle,
  repo: StorageRepository,
  ticker: string,
  today: IsoDate,
): Promise<void> {
  const analyst = registry.providersFor("analystTargets")[0];
  if (analyst?.getAnalystTargets !== undefined) {
    const fetch = analyst.getAnalystTargets.bind(analyst);
    await repo.insertAnalystSnapshot(await throttle(() => fetch(ticker)));
  }
  const earnings = registry.providersFor("earningsCalendar")[0];
  if (earnings?.getNextEarnings !== undefined) {
    const fetch = earnings.getNextEarnings.bind(earnings);
    await repo.insertEarningsSnapshot(await throttle(() => fetch(ticker)));
  }
  const dividends = registry.providersFor("dividendCalendar")[0];
  if (dividends?.getNextExDividend !== undefined) {
    const fetch = dividends.getNextExDividend.bind(dividends);
    await repo.insertDividendSnapshot(await throttle(() => fetch(ticker)));
  }
  await repo.recordMetadataSync(ticker, today);
}
