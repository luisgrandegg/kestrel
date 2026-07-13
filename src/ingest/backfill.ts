import type { KestrelConfig } from "../config/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { Repository } from "../storage/repository.js";
import type { Instrument, IsoDate } from "../types/index.js";
import {
  promoteWhenCovered,
  recordFailure,
  startBackfill,
} from "./lifecycle.js";
import { type FetchCloses, syncPrices } from "./prices.js";
import { fetchMetadataSnapshots } from "./snapshots.js";
import { makeThrottle, ProviderCallError, type Throttle } from "./throttle.js";
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
  repo: Repository;
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
  const throttle =
    deps.throttle ??
    makeThrottle(deps.sleep, config.ingestion.interCallDelayMs);

  registerWatchlist(repo, watchlist, today);
  const targets = syncableInstruments(repo, watchlist).filter(
    (i) => i.state === "pending" || i.state === "backfilling",
  );

  const report: BackfillReport = {
    processed: [],
    promoted: [],
    failures: [],
    errored: [],
    skippedErrored: erroredInstruments(repo, watchlist).map((i) => i.ticker),
  };

  for (const instrument of targets) {
    const { ticker } = instrument;
    const state = startBackfill(instrument.state);
    if (state !== instrument.state) {
      repo.setInstrumentState(ticker, state);
    }
    try {
      await backfillOne(deps, fetchCloses, throttle, instrument);
      repo.resetFailures(ticker);
      report.processed.push(ticker);

      const covered = repo.lastNCloses(
        ticker,
        config.fluctuation.lookbackTradingDays,
        today,
      ).length;
      const next = promoteWhenCovered(
        state,
        covered,
        config.fluctuation.lookbackTradingDays,
      );
      if (next !== state) {
        repo.setInstrumentState(ticker, next);
        report.promoted.push(ticker);
      }
    } catch (error) {
      if (!(error instanceof ProviderCallError)) {
        // Local storage/logic failure — not the adapter's fault. Abort
        // loudly rather than mis-charging the instrument's failure streak.
        throw error;
      }
      const failures = repo.incrementFailures(ticker);
      report.failures.push({ ticker, message: error.message });
      const next = recordFailure(
        state,
        failures,
        config.ingestion.maxConsecutiveFailures,
      );
      if (next === "error") {
        repo.setInstrumentState(ticker, "error");
        report.errored.push(ticker);
      }
    }
  }

  return report;
}

async function backfillOne(
  deps: BackfillDeps,
  fetchCloses: FetchCloses,
  throttle: Throttle,
  instrument: Instrument,
): Promise<void> {
  const { repo, registry, config, today } = deps;
  const { ticker } = instrument;

  await syncPrices(
    repo,
    fetchCloses,
    throttle,
    ticker,
    today,
    config.ingestion.backfillLookbackDays,
  );

  // Initial metadata snapshots on first bring-up only; the TTL refresh
  // cadence is the daily runner's job (item 013).
  if (instrument.lastMetadataSync === null) {
    await fetchMetadataSnapshots(registry, throttle, repo, ticker, today);
  }
}
