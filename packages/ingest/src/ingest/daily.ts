import type { IsoDate } from "@kestrel/core/types";
import {
  type BackfillDeps,
  type BackfillReport,
  runBackfill,
} from "./backfill.js";
import { addDays } from "./dates.js";
import { chargeProviderFailure } from "./failures.js";
import { syncInstrumentCurrency, syncPrices } from "./prices.js";
import { fetchMetadataSnapshots } from "./snapshots.js";
import { makeThrottle } from "./throttle.js";
import {
  erroredInstruments,
  registerWatchlist,
  syncableInstruments,
} from "./watchlist.js";

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
  /** Watchlist instruments already in sticky `error` state when the run
   * started (never attempted; instruments demoted THIS run are in
   * `errored`, not here). */
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
  // Currency travels with closes (ADR-0012); defensive-optional like backfill.
  const fetchInfo = closesProvider.getInstrumentInfo?.bind(closesProvider);
  const throttle =
    deps.throttle ??
    makeThrottle(deps.sleep, config.ingestion.interCallDelayMs);

  await registerWatchlist(repo, watchlist, today);
  const ready = (await syncableInstruments(repo, watchlist)).filter(
    (i) => i.state === "ready",
  );
  // Snapshot BEFORE the refresh loop: instruments demoted this run belong
  // in `errored`, not in `skippedErrored`.
  const skippedErrored = (await erroredInstruments(repo, watchlist)).map(
    (i) => i.ticker,
  );

  const report: Omit<DailyReport, "backfill" | "skippedErrored"> = {
    refreshed: [],
    metadataRefreshed: [],
    failures: [],
    errored: [],
  };

  for (const instrument of ready) {
    const { ticker } = instrument;
    // A ready instrument always has stored history (promotion required
    // coverage). Its absence means a back-dated run date or tampered
    // storage — fail loud instead of silently re-fetching a year.
    if ((await repo.latestClose(ticker, today)) === undefined) {
      throw new Error(
        `Invariant violated: ready instrument ${ticker} has no stored close on or before ${today} — refusing to silently re-backfill; check the injected run date`,
      );
    }
    try {
      // Once-per-day run dedupe: a successful sync already stamped today.
      // (The stamp only lands on success, so failure retries are never
      // blocked; a close published later today arrives on tomorrow's run.)
      if (instrument.lastPriceSync !== today) {
        await syncPrices(
          repo,
          fetchCloses,
          throttle,
          ticker,
          today,
          config.ingestion.backfillLookbackDays,
        );
      }
      // Copy the native currency if it was never captured (e.g. an
      // instrument promoted before the currency surface existed) — first
      // sync only, never refetched once known (ADR-0012 decision 3).
      if (fetchInfo !== undefined && instrument.currency === null) {
        await syncInstrumentCurrency(repo, fetchInfo, throttle, ticker);
      }
      // Prices are stored at this point: report it even if metadata below
      // fails — the report must not claim prices were not updated.
      report.refreshed.push(ticker);
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
      // Reset only when the WHOLE body succeeded: resetting after prices
      // alone would pin the streak at 1 and a broken metadata endpoint
      // could never demote (MVP §7 "repeated adapter failure").
      await repo.resetFailures(ticker);
    } catch (error) {
      const charged = await chargeProviderFailure(
        repo,
        config,
        instrument.state,
        ticker,
        error,
      );
      report.failures.push({ ticker, message: charged.message });
      if (charged.errored) {
        report.errored.push(ticker);
      }
    }
  }

  // Phase 2: continue backfill with the SAME throttle, so the boundary
  // between phases also respects interCallDelayMs.
  const backfill = await runBackfill({ ...deps, throttle }, watchlist);

  return { ...report, skippedErrored, backfill };
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
