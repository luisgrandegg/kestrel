import type { KestrelConfig } from "../config/index.js";
import type { Provider } from "../providers/provider.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { Repository } from "../storage/repository.js";
import type { Instrument, IsoDate } from "../types/index.js";
import { addDays } from "./dates.js";
import {
  promoteWhenCovered,
  recordFailure,
  startBackfill,
} from "./lifecycle.js";
import { registerWatchlist, syncableInstruments } from "./watchlist.js";

/**
 * Backfill runner (backlog item 012) — MVP.md §7 step 2.
 *
 * For each pending/backfilling instrument: fetch the missing slice of the
 * backfill window (a resumed run continues from the latest stored close, so
 * a capped/slow provider accumulates history across runs without
 * duplication), write it through the repository's insert-or-ignore, fetch
 * the initial metadata snapshots on first bring-up, and promote to `ready`
 * once stored history covers the fluctuation lookback.
 *
 * Ingestion computes nothing (CONSTITUTION.md §2.2). The run date and the
 * sleeper are injected — nothing here reads the wall clock (guardrail 2).
 * Every provider call is preceded by the configured inter-call delay
 * (slow-but-correct is a feature, guardrail on §3.3).
 *
 * One instrument's failure never aborts the run: the failure streak is
 * persisted, the instrument demotes to `error` at the configured threshold
 * (sticky — decision on backlog 011), and the report names every failure so
 * nothing is silent.
 */

export interface BackfillDeps {
  repo: Repository;
  registry: ProviderRegistry;
  config: KestrelConfig;
  /** The run's as-of date (UTC trading-calendar date), injected. */
  today: IsoDate;
  /** Injected sleeper so tests observe the throttle without waiting. */
  sleep: (ms: number) => Promise<void>;
}

export interface BackfillReport {
  /** Instruments successfully processed this run (may still be partial). */
  processed: string[];
  /** Instruments promoted to `ready` this run. */
  promoted: string[];
  /** Per-instrument failures recorded this run — never silent. */
  failures: { ticker: string; message: string }[];
  /** Instruments that hit the failure threshold and were marked `error`. */
  errored: string[];
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

  registerWatchlist(repo, watchlist, today);
  const targets = syncableInstruments(repo, watchlist).filter(
    (i) => i.state === "pending" || i.state === "backfilling",
  );

  const report: BackfillReport = {
    processed: [],
    promoted: [],
    failures: [],
    errored: [],
  };

  // Throttle: sleep before every provider call except the very first.
  let anyCallMade = false;
  const throttled = async <T>(call: () => Promise<T>): Promise<T> => {
    if (anyCallMade) {
      await deps.sleep(config.ingestion.interCallDelayMs);
    }
    anyCallMade = true;
    return call();
  };

  for (const instrument of targets) {
    const { ticker } = instrument;
    if (instrument.state === "pending") {
      repo.setInstrumentState(ticker, startBackfill(instrument.state));
    }
    try {
      await backfillOne(deps, closesProvider, instrument, throttled);
      repo.resetFailures(ticker);
      report.processed.push(ticker);

      const covered = repo.lastNCloses(
        ticker,
        config.fluctuation.lookbackTradingDays,
        today,
      ).length;
      const next = promoteWhenCovered(
        "backfilling",
        covered,
        config.fluctuation.lookbackTradingDays,
      );
      if (next === "ready") {
        repo.setInstrumentState(ticker, "ready");
        report.promoted.push(ticker);
      }
    } catch (error) {
      const failures = repo.incrementFailures(ticker);
      report.failures.push({
        ticker,
        message: error instanceof Error ? error.message : String(error),
      });
      const next = recordFailure(
        "backfilling",
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
  closesProvider: Provider,
  instrument: Instrument,
  throttled: <T>(call: () => Promise<T>) => Promise<T>,
): Promise<void> {
  const { repo, registry, config, today } = deps;
  const { ticker } = instrument;

  // Resume from the latest stored close; a fresh instrument starts at the
  // beginning of the backfill window. Bounds are inclusive (Provider
  // contract), so the resume cursor is the day after the latest close.
  const latest = repo.latestClose(ticker, today);
  const from =
    latest === undefined
      ? addDays(today, -config.ingestion.backfillLookbackDays)
      : addDays(latest.date, 1);
  if (from <= today && closesProvider.getCloses !== undefined) {
    const fetchCloses = closesProvider.getCloses.bind(closesProvider);
    const closes = await throttled(() => fetchCloses(ticker, from, today));
    repo.insertCloses(closes);
  }
  repo.recordPriceSync(ticker, today);

  // Initial metadata snapshots on first bring-up only; the TTL refresh
  // cadence is the daily runner's job (item 013). A capability served by no
  // provider is skipped — the registry disables the dependent screens, which
  // is the sanctioned degradation path (guardrail 4), not fabrication.
  if (instrument.lastMetadataSync === null) {
    const analyst = registry.providersFor("analystTargets")[0];
    if (analyst?.getAnalystTargets !== undefined) {
      const fetch = analyst.getAnalystTargets.bind(analyst);
      repo.insertAnalystSnapshot(await throttled(() => fetch(ticker)));
    }
    const earnings = registry.providersFor("earningsCalendar")[0];
    if (earnings?.getNextEarnings !== undefined) {
      const fetch = earnings.getNextEarnings.bind(earnings);
      repo.insertEarningsSnapshot(await throttled(() => fetch(ticker)));
    }
    const dividends = registry.providersFor("dividendCalendar")[0];
    if (dividends?.getNextExDividend !== undefined) {
      const fetch = dividends.getNextExDividend.bind(dividends);
      repo.insertDividendSnapshot(await throttled(() => fetch(ticker)));
    }
    repo.recordMetadataSync(ticker, today);
  }
}
