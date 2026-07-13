import type { IsoDate } from "../types/index.js";
import {
  type BackfillDeps,
  type BackfillReport,
  runBackfill,
} from "./backfill.js";
import { addDays } from "./dates.js";
import { recordFailure } from "./lifecycle.js";
import { syncPrices } from "./prices.js";
import { fetchMetadataSnapshots } from "./snapshots.js";
import { makeThrottle, ProviderCallError } from "./throttle.js";
import { registerWatchlist, syncableInstruments } from "./watchlist.js";

/**
 * Daily run (backlog item 013) — MVP.md §7, both steps in ONE throttled run:
 *
 * 1. For each `ready` instrument: fetch only the missing recent trading
 *    days (cursor = latest stored close), and refresh metadata snapshots
 *    only once `metadataTtlDays` has elapsed since `last_metadata_sync`.
 * 2. Continue backfilling `pending`/`backfilling` instruments (item 012's
 *    runner), sharing the same throttle so the phase boundary also sleeps
 *    `interCallDelayMs` (§7 step 3, "throughout").
 *
 * Weekend/holiday runs are harmless no-ops: the incremental window contains
 * no trading days, providers return nothing, insert-or-ignore dedupes by
 * date. Same-day re-runs make no provider calls at all.
 *
 * Failure attribution matches the backfill runner: only tagged provider
 * failures feed the persistent streak (sticky `error` at the configured
 * threshold); local errors abort the run loudly.
 */

export interface DailyReport {
  /** Ready instruments whose prices were refreshed this run. */
  refreshed: string[];
  /** Instruments whose metadata TTL elapsed and was re-snapshotted. */
  metadataRefreshed: string[];
  /** Per-instrument provider failures in the refresh phase. */
  failures: { ticker: string; message: string }[];
  /** Instruments demoted to `error` during the refresh phase. */
  errored: string[];
  /** Sticky-error watchlist instruments skipped by this run. */
  skippedErrored: string[];
  /** Phase 2: the embedded backfill run over pending/backfilling. */
  backfill: BackfillReport;
}

export async function runDaily(
  deps: BackfillDeps,
  watchlist: readonly string[],
): Promise<DailyReport> {
  const { repo, registry, config, today } = deps;

  const closesProvider = registry.providersFor("closes")[0];
  if (closesProvider?.getCloses === undefined) {
    throw new Error(
      'Cannot run the daily refresh: no active provider serves the "closes" capability',
    );
  }
  const fetchCloses = closesProvider.getCloses.bind(closesProvider);
  const throttle =
    deps.throttle ??
    makeThrottle(deps.sleep, config.ingestion.interCallDelayMs);

  registerWatchlist(repo, watchlist, today);
  const ready = syncableInstruments(repo, watchlist).filter(
    (i) => i.state === "ready",
  );

  const report: Omit<DailyReport, "backfill" | "skippedErrored"> = {
    refreshed: [],
    metadataRefreshed: [],
    failures: [],
    errored: [],
  };

  for (const instrument of ready) {
    const { ticker } = instrument;
    try {
      await syncPrices(
        repo,
        fetchCloses,
        throttle,
        ticker,
        today,
        config.ingestion.backfillLookbackDays,
      );
      if (
        metadataDue(
          instrument.lastMetadataSync,
          today,
          config.ingestion.metadataTtlDays,
        )
      ) {
        await fetchMetadataSnapshots(registry, throttle, repo, ticker, today);
        report.metadataRefreshed.push(ticker);
      }
      repo.resetFailures(ticker);
      report.refreshed.push(ticker);
    } catch (error) {
      if (!(error instanceof ProviderCallError)) {
        throw error;
      }
      const failures = repo.incrementFailures(ticker);
      report.failures.push({ ticker, message: error.message });
      const next = recordFailure(
        instrument.state,
        failures,
        config.ingestion.maxConsecutiveFailures,
      );
      if (next === "error") {
        repo.setInstrumentState(ticker, "error");
        report.errored.push(ticker);
      }
    }
  }

  // Phase 2: continue backfill with the SAME throttle, so the boundary
  // between phases also respects interCallDelayMs.
  const backfill = await runBackfill({ ...deps, throttle }, watchlist);

  return { ...report, skippedErrored: backfill.skippedErrored, backfill };
}

/** Metadata is due when never fetched or the TTL has elapsed. */
function metadataDue(
  lastMetadataSync: IsoDate | null,
  today: IsoDate,
  metadataTtlDays: number,
): boolean {
  return (
    lastMetadataSync === null ||
    addDays(lastMetadataSync, metadataTtlDays) <= today
  );
}
