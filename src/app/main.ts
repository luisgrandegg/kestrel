import { loadConfig } from "../config/index.js";
import { type DailyReport, runDaily } from "../ingest/daily.js";
import { loadWatchlist } from "../ingest/watchlist.js";
import type { Provider } from "../providers/provider.js";
import { ProviderRegistry } from "../providers/registry.js";
import { Repository } from "../storage/repository.js";
import type { IsoDate } from "../types/index.js";
import { buildDashboard } from "./dashboard.js";
import { activeProviders } from "./providers.js";

/**
 * The daily pipeline (backlog item 019, M7): throttled ingestion (when a
 * provider serves "closes"), then the dashboard rendered from stored data.
 * Paths are explicit — the module-level defaults are cwd-relative and
 * assume repo-root invocation — and `today` arrives as an injected UTC
 * calendar date (the CLI derives it; nothing here reads the clock).
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
  const registry = new ProviderRegistry(options.providers ?? activeProviders());
  const repo = new Repository(options.dbPath);
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
      log(
        `ingestion ${options.today}: refreshed ${report.refreshed.length}, ` +
          `metadata ${report.metadataRefreshed.length}, ` +
          `backfill processed ${report.backfill.processed.length} ` +
          `(promoted ${report.backfill.promoted.length}), ` +
          `failures ${report.failures.length}, errored ${report.errored.length}, ` +
          `skipped errored ${report.skippedErrored.length}`,
      );
    } else {
      log(
        'no active provider serves "closes" — ingestion skipped (the Yahoo ' +
          "adapter is backlog item 010); rendering from stored data only",
      );
    }
    return {
      dashboard: buildDashboard(repo, registry, config, options.today),
      report,
    };
  } finally {
    repo.close();
  }
}
