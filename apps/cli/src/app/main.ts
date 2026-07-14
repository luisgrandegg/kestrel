import { loadConfig } from "@kestrel/core/config";
import type { StorageRepository } from "@kestrel/core/storage/port";
import { Repository } from "@kestrel/core/storage/repository";
import type { IsoDate } from "@kestrel/core/types";
import { type DailyReport, runDaily } from "@kestrel/ingest/ingest/daily";
import { loadWatchlist } from "@kestrel/ingest/ingest/watchlist";
import { activeProviders } from "@kestrel/ingest/providers/active";
import type { Provider } from "@kestrel/ingest/providers/provider";
import { ProviderRegistry } from "@kestrel/ingest/providers/registry";
import { buildDashboard } from "./dashboard.js";

/**
 * The daily pipeline (backlog item 019, M7): throttled ingestion (when a
 * provider serves "closes"), then the dashboard rendered from stored data.
 * The db/watchlist paths are explicit (the module-level defaults are
 * cwd-relative and assume repo-root invocation); the config path is
 * optional BY CONTRACT — absent means the §9 defaults, and the CLI
 * resolves the override file explicitly so that choice is observable.
 * `today` arrives as an injected UTC calendar date (the CLI derives it;
 * nothing here reads the clock).
 */
export interface DailyRunOptions {
  dbPath: string;
  watchlistPath: string;
  /** Optional config-override file; omitted means §9 defaults. */
  configPath?: string;
  /** The run's UTC calendar date — the idempotency/dedupe key. */
  today: IsoDate;
  /** Injectable for tests; defaults to the registered adapters. */
  providers?: Provider[];
  /** Injectable throttle sleeper; defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export interface DailyRunResult {
  dashboard: string;
  /** Null when ingestion was skipped for lack of a "closes" provider. */
  report: DailyReport | null;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function runDailyPipeline(
  options: DailyRunOptions,
): Promise<DailyRunResult> {
  const log = options.log ?? (() => {});
  const config = loadConfig(options.configPath);
  const watchlist = loadWatchlist(options.watchlistPath);
  const registry = new ProviderRegistry(
    options.providers ?? activeProviders(() => options.today),
  );
  const repo: StorageRepository = new Repository(options.dbPath);
  try {
    let report: DailyReport | null = null;
    if (registry.isServed("closes")) {
      report = await runDaily(
        {
          repo,
          registry,
          config,
          today: options.today,
          sleep: options.sleep ?? realSleep,
        },
        watchlist,
      );
      // Surface BOTH phases' provider failures: a run where every backfill
      // fetch failed (e.g. the provider is unreachable) must never read as a
      // quiet success — the failures are charged to each instrument's streak
      // but would otherwise be invisible on stdout (guardrail 4, fail loud).
      const totalFailures =
        report.failures.length + report.backfill.failures.length;
      const totalErrored =
        report.errored.length + report.backfill.errored.length;
      log(
        `ingestion ${options.today}: refreshed ${report.refreshed.length}, ` +
          `metadata ${report.metadataRefreshed.length}, ` +
          `backfill processed ${report.backfill.processed.length} ` +
          `(promoted ${report.backfill.promoted.length}), ` +
          `failures ${totalFailures}, errored ${totalErrored}, ` +
          `skipped errored ${report.skippedErrored.length}`,
      );
      for (const { ticker, message } of report.backfill.failures) {
        log(`  backfill failure ${ticker}: ${message}`);
      }
      for (const { ticker, message } of report.failures) {
        log(`  refresh failure ${ticker}: ${message}`);
      }
    } else {
      log(
        'no active provider serves "closes" — ingestion skipped; rendering ' +
          "from stored data only",
      );
    }
    return {
      dashboard: await buildDashboard(repo, registry, config, options.today),
      report,
    };
  } finally {
    await repo.close();
  }
}
