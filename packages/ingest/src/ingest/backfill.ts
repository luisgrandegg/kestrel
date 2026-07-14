import type { KestrelConfig } from "@kestrel/core/config";
import type { StorageRepository } from "@kestrel/core/storage/port";
import type { IsoDate } from "@kestrel/core/types";
import type { ProviderRegistry } from "../providers/registry.js";
import { chargeProviderFailure } from "./failures.js";
import { promoteWhenCovered, startBackfill } from "./lifecycle.js";
import { syncInstrumentCurrency, syncPrices } from "./prices.js";
import { fetchMetadataSnapshots } from "./snapshots.js";
import { makeThrottle, type Throttle } from "./throttle.js";
import {
  erroredInstruments,
  registerWatchlist,
  syncableInstruments,
} from "./watchlist.js";

/**
 * Backfill runner (backlog item 012) — MVP.md §7 step 2.
 *
 * For each pending/backfilling instrument: fetch the missing slice of the
 * backfill window (a resumed run continues from the latest stored close, so
 * a capped/slow provider accumulates history across runs without
 * duplication), validate and write it through the repository's
 * insert-or-ignore, fetch the initial metadata snapshots on first bring-up,
 * and promote to `ready` once stored history covers the fluctuation
 * lookback.
 *
 * Ingestion computes nothing (CONSTITUTION.md §2.2). The run date, sleeper,
 * and (optionally) the throttle are injected — nothing here reads the wall
 * clock (guardrail 2), and item 013 shares one throttle across its phases.
 *
 * Failure attribution (MVP §7): only provider-call failures — tagged
 * ProviderCallError, including validation of what the provider returned —
 * feed the persistent streak that demotes to sticky `error`. Local storage
 * or logic errors rethrow and abort the run loudly.
 */

export interface BackfillDeps {
  repo: StorageRepository;
  registry: ProviderRegistry;
  config: KestrelConfig;
  /** The run's as-of date (UTC trading-calendar date), injected. */
  today: IsoDate;
  /** Injected sleeper so tests observe the throttle without waiting. */
  sleep: (ms: number) => Promise<void>;
  /** Share one throttle across a whole daily run; defaults to a fresh one. */
  throttle?: Throttle;
}

export interface BackfillReport {
  /** Instruments successfully processed this run (may still be partial). */
  processed: string[];
  /** Instruments promoted to `ready` this run. */
  promoted: string[];
  /** Per-instrument provider failures recorded this run — never silent. */
  failures: { ticker: string; message: string }[];
  /** Instruments that hit the failure threshold and were marked `error`. */
  errored: string[];
  /**
   * Watchlist instruments sitting in sticky `error` state, skipped by this
   * run. Surfaced so a dead watchlist is never indistinguishable from
   * "nothing to do" (guardrail 4).
   */
  skippedErrored: string[];
}

export async function runBackfill(
  deps: BackfillDeps,
  watchlist: readonly string[],
): Promise<BackfillReport> {
  const { repo, registry, config, today } = deps;

  const closesProvider = registry.providersFor("closes")[0];
  if (closesProvider?.getCloses === undefined) {
    throw new Error(
      'Cannot backfill: no active provider serves the "closes" capability',
    );
  }
  const fetchCloses = closesProvider.getCloses.bind(closesProvider);
  // Currency travels with the closes capability (ADR-0012); a provider
  // serving closes backs getInstrumentInfo (registry-enforced), but stay
  // defensive so a missing surface degrades rather than crashes.
  const fetchInfo = closesProvider.getInstrumentInfo?.bind(closesProvider);
  const throttle =
    deps.throttle ??
    makeThrottle(deps.sleep, config.ingestion.interCallDelayMs);

  await registerWatchlist(repo, watchlist, today);
  const targets = (await syncableInstruments(repo, watchlist)).filter(
    (i) => i.state === "pending" || i.state === "backfilling",
  );

  const report: BackfillReport = {
    processed: [],
    promoted: [],
    failures: [],
    errored: [],
    skippedErrored: (await erroredInstruments(repo, watchlist)).map(
      (i) => i.ticker,
    ),
  };

  for (const instrument of targets) {
    const { ticker } = instrument;
    const state = startBackfill(instrument.state);
    if (state !== instrument.state) {
      await repo.setInstrumentState(ticker, state);
    }
    try {
      // Prices first — the ONLY step that gates coverage and promotion.
      await syncPrices(
        repo,
        fetchCloses,
        throttle,
        ticker,
        today,
        config.ingestion.backfillLookbackDays,
      );
      report.processed.push(ticker);

      // Initial metadata snapshots on first bring-up GATE promotion — a
      // `ready` instrument should already carry its screening inputs (analyst
      // targets, event dates); the TTL refresh cadence is the daily runner's
      // job. A failure here lands in the catch and blocks promotion this run.
      if (instrument.lastMetadataSync === null) {
        await fetchMetadataSnapshots(registry, throttle, repo, ticker, today);
      }

      // Promotion depends on stored price coverage plus initial metadata
      // above (CONSTITUTION.md: `ready` = history covers lookbackTradingDays).
      const covered = (
        await repo.lastNCloses(
          ticker,
          config.fluctuation.lookbackTradingDays,
          today,
        )
      ).length;
      const next = promoteWhenCovered(
        state,
        covered,
        config.fluctuation.lookbackTradingDays,
      );
      if (next !== state) {
        await repo.setInstrumentState(ticker, next);
        report.promoted.push(ticker);
      }

      // Currency is a presentation label, NOT a readiness criterion (a ready
      // instrument with currency == null renders "?"), so it copies best-
      // effort AFTER promotion — a flaky currency surface must never strand a
      // price-complete instrument short of `ready`. Copy-once (ADR-0012
      // decision 3); a failure still charges the streak via the catch, but
      // the promotion above stands. The daily runner retries it.
      if (fetchInfo !== undefined && instrument.currency === null) {
        await syncInstrumentCurrency(repo, fetchInfo, throttle, ticker);
      }
      // Reset only when the WHOLE body succeeded — a currency failure lands
      // in the catch and keeps the streak.
      await repo.resetFailures(ticker);
    } catch (error) {
      const charged = await chargeProviderFailure(
        repo,
        config,
        state,
        ticker,
        error,
      );
      report.failures.push({ ticker, message: charged.message });
      if (charged.errored) {
        report.errored.push(ticker);
      }
    }
  }

  return report;
}
