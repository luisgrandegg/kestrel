import {
  type ConfigOverrides,
  type KestrelConfig,
  resolveConfig,
} from "@kestrel/core/config";
import {
  type Category1Match,
  makeCategory1Screen,
} from "@kestrel/core/screens/category1";
import {
  type Category2Match,
  makeCategory2Screen,
} from "@kestrel/core/screens/category2";
import {
  type Category3Match,
  makeCategory3Screen,
} from "@kestrel/core/screens/category3";
import type { StorageRepository } from "@kestrel/core/storage/port";
import { PostgresRepository } from "@kestrel/core/storage/postgres";
import type {
  Capability,
  IsoDate,
  ScreenEvaluation,
} from "@kestrel/core/types";
import { type DailyReport, runDaily } from "@kestrel/ingest/ingest/daily";
import { normalizeTicker } from "@kestrel/ingest/ingest/watchlist";
import { activeProviders } from "@kestrel/ingest/providers/active";
import { ProviderRegistry } from "@kestrel/ingest/providers/registry";
import watchlistJson from "../../../../../watchlist.json";
import { poolExecutor } from "./db";
import { buildSnapshots, evaluateScreen } from "./evaluateScreens";

/**
 * Composition glue for the web app (ADR-0011) — the sole composition root:
 * it wires storage (Supabase Postgres via the pg-pool executor), the
 * provider registry, config, and the watchlist, and exposes the two
 * operations the routes need: `getDashboardData` (screen results as data,
 * rendered by page.tsx) and `runIngestion` (the daily pipeline behind the
 * Vercel-Cron route).
 *
 * Config: there is no repo-root cwd on Vercel, so file-based overrides
 * (kestrel.config.json) don't apply here — overrides arrive as JSON in the
 * KESTREL_CONFIG env var instead; absent means the MVP.md §9 defaults, and
 * invalid JSON fails loud (a typo'd config must never silently present
 * defaults as tuned thresholds). The watchlist is the repo-root
 * watchlist.json, bundled at build time via direct JSON import.
 */

/** The §8 dashboard, as data: the three typed screen evaluations. */
export interface DashboardData {
  asOf: IsoDate;
  category1: ScreenEvaluation<Category1Match>;
  category2: ScreenEvaluation<Category2Match>;
  category3: ScreenEvaluation<Category3Match>;
}

/**
 * Evaluate the three MVP screens over one set of as-of-bounded snapshots,
 * returning the §8 dashboard as data (rendered by page.tsx).
 * Typed against the StorageRepository PORT, never an engine: tests run it
 * over SQLite, production hands it the Postgres repository.
 */
export async function getDashboardData(
  repo: StorageRepository,
  registry: ProviderRegistry,
  config: KestrelConfig,
  asOf: IsoDate,
): Promise<DashboardData> {
  const category1 = makeCategory1Screen(config);
  const category2 = makeCategory2Screen(config);
  const category3 = makeCategory3Screen(config);

  const anyEnabled = [category1, category2, category3].some(
    (screen: { requiredCapabilities: readonly Capability[] }) =>
      registry.resolveScreen(screen.requiredCapabilities).enabled,
  );
  const snapshots = anyEnabled ? await buildSnapshots(repo, config, asOf) : [];

  return {
    asOf,
    category1: evaluateScreen(snapshots, registry, category1),
    category2: evaluateScreen(snapshots, registry, category2),
    category3: evaluateScreen(snapshots, registry, category3),
  };
}

/**
 * Resolve config from a KESTREL_CONFIG-shaped raw value: undefined/blank
 * means the §9 defaults; anything else must parse to a JSON object of
 * overrides (resolveConfig then rejects unknown keys and bad values).
 * Pure so the env-var path is unit-testable.
 */
export function configFromEnv(raw: string | undefined): KestrelConfig {
  if (raw === undefined || raw.trim() === "") {
    return resolveConfig();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      "KESTREL_CONFIG is not valid JSON — it must be a JSON object of config overrides (MVP.md §9 keys)",
      { cause: error },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `KESTREL_CONFIG must be a JSON object of config overrides, got: ${raw}`,
    );
  }
  return resolveConfig(parsed as ConfigOverrides);
}

/** Active config: KESTREL_CONFIG overrides merged over the §9 defaults. */
export function webConfig(): KestrelConfig {
  return configFromEnv(process.env.KESTREL_CONFIG);
}

/**
 * The registry over the single adapter-registration point (@kestrel/ingest).
 * The active adapters read no wall clock: the run/as-of date is injected as
 * `today` (ADR-0012) — the caller passes the same UTC calendar date it uses
 * as the as-of bound (the page) or the ingestion run date (the cron route).
 */
export function registry(today: IsoDate): ProviderRegistry {
  return new ProviderRegistry(activeProviders(() => today));
}

// Module-level lazy singleton, like the pool under it: a warm serverless
// instance reuses the repository across invocations. Never closed — the
// pool's lifetime is the process's.
let repo: StorageRepository | undefined;

/** The production repository: Postgres (Supabase) over the pg-pool executor. */
export function repository(): StorageRepository {
  if (repo === undefined) {
    repo = new PostgresRepository(poolExecutor());
  }
  return repo;
}

/** Normalized, deduped watchlist (bundled from the repo-root watchlist.json). */
export function watchlist(): string[] {
  const tickers: string[] = [];
  const seen = new Set<string>();
  for (const entry of watchlistJson) {
    const ticker = normalizeTicker(entry);
    if (!seen.has(ticker)) {
      seen.add(ticker);
      tickers.push(ticker);
    }
  }
  return tickers;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface IngestionOutcome {
  /** Null when ingestion was skipped for lack of a "closes" provider. */
  report: DailyReport | null;
  /** Human-readable reason when report is null. */
  skipped: string | null;
}

/**
 * The daily ingestion pipeline (the cron route's body): run the throttled
 * daily refresh + backfill over the registered adapters (the Yahoo adapter
 * serves "closes"). The skip branch
 * remains as defensive degradation: were no active provider to serve
 * "closes", it would skip loudly rather than fabricate. Idempotent and
 * resumable by design, so a function timeout mid-backfill simply resumes on
 * the next cron fire.
 */
export async function runIngestion(today: IsoDate): Promise<IngestionOutcome> {
  const providerRegistry = registry(today);
  if (!providerRegistry.isServed("closes")) {
    return {
      report: null,
      skipped: 'no active provider serves "closes" — ingestion skipped',
    };
  }
  const report = await runDaily(
    {
      repo: repository(),
      registry: providerRegistry,
      config: webConfig(),
      today,
      sleep: realSleep,
    },
    watchlist(),
  );
  return { report, skipped: null };
}
