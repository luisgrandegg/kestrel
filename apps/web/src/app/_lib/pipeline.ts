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
import { poolExecutor } from "./db";
import { buildSnapshots, evaluateScreen } from "./evaluateScreens";

/**
 * Composition glue for the web app (ADR-0011) — the sole composition root:
 * it wires storage (Supabase Postgres via the pg-pool executor), the
 * provider registry, and config, and exposes the operations the routes and
 * server actions need: `getDashboardData` (per-user screen results as data,
 * rendered by page.tsx), `runIngestion` (the daily union pipeline behind the
 * Vercel-Cron route), and the per-user watchlist helpers (`userTickers`,
 * `addTicker`, `removeTicker` — item 021).
 *
 * Config: there is no repo-root cwd on Vercel, so file-based overrides
 * (kestrel.config.json) don't apply here — overrides arrive as JSON in the
 * KESTREL_CONFIG env var instead; absent means the MVP.md §9 defaults, and
 * invalid JSON fails loud (a typo'd config must never silently present
 * defaults as tuned thresholds). The watchlist is per-user, stored behind the
 * storage port (`user_watchlist`); ingestion fetches the union of all users'
 * tickers (item 021, ADR-0013 — `watchlist.json` retired).
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
  tickers: readonly string[],
): Promise<DashboardData> {
  const category1 = makeCategory1Screen(config);
  const category2 = makeCategory2Screen(config);
  const category3 = makeCategory3Screen(config);

  const anyEnabled = [category1, category2, category3].some(
    (screen: { requiredCapabilities: readonly Capability[] }) =>
      registry.resolveScreen(screen.requiredCapabilities).enabled,
  );
  // Per-user (item 021): evaluate only the requesting user's watchlist over
  // the shared market data. An empty watchlist filters every instrument out →
  // no snapshots → every screen reports "no matches" (the page shows the
  // empty-state UI instead). buildSnapshots handles the empty set itself, so
  // the filter — not a caller-side short-circuit — is what makes "empty
  // watchlist" mean "no tickers", never "all tickers".
  const snapshots = anyEnabled
    ? await buildSnapshots(repo, config, asOf, tickers)
    : [];

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

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---- per-user watchlists (item 021) ----

/** One user's tickers, sorted (the set their dashboard is evaluated over). */
export function userTickers(userId: string): Promise<string[]> {
  return repository().getUserWatchlist(userId);
}

/**
 * Add a ticker to a user's watchlist (item 021). Normalizes it (item 011
 * rules), registers the instrument as `pending` if no user tracked it yet,
 * records the membership, and kicks an immediate throttled backfill so the
 * ticker starts populating without waiting for the next cron. Idempotent and
 * resumable, so it composes with the daily cron (whichever runs first wins).
 * Returns the normalized ticker.
 *
 * Re-adding a ticker that had reached the sticky `error` state (item 011's
 * repeated-failure lockout) resets it to `pending` and clears its failure
 * streak: an explicit user re-add IS the "someone intervenes" that unsticks
 * it, so it gets retried instead of silently staying dead.
 */
export async function addTicker(
  userId: string,
  rawTicker: string,
  today: IsoDate,
): Promise<string> {
  const ticker = normalizeTicker(rawTicker);
  const repo = repository();
  const before = await repo.getInstrument(ticker);
  await repo.addInstrument(ticker, today); // no-op if it already exists
  await repo.addToWatchlist(userId, ticker, today);
  if (before?.state === "error") {
    await repo.setInstrumentState(ticker, "pending");
    await repo.resetFailures(ticker);
  }
  await kickBackfill(today, ticker);
  return ticker;
}

/**
 * Remove a ticker from a user's watchlist (item 021). If no user tracks it
 * afterwards it simply drops out of the ingestion union — its stored history
 * is retained (append-only).
 */
export async function removeTicker(
  userId: string,
  rawTicker: string,
): Promise<void> {
  await repository().removeFromWatchlist(userId, normalizeTicker(rawTicker));
}

/**
 * On-demand throttled backfill for a single just-added ticker (item 021).
 * Reuses the daily pipeline over a one-ticker list: ~a handful of throttled
 * calls (the dashboard page raises `maxDuration` to give it headroom).
 * Idempotent with the cron. Best-effort — a provider outage leaves the ticker
 * `pending` to be picked up by the next cron, so failures are swallowed here
 * (the daily run is the durable path and reports them).
 *
 * Concurrency: if a user adds a ticker exactly as the daily cron sweeps the
 * same one, two runDaily runs can overlap. Observation writes are
 * insert-or-ignore (safe); the only contention is the instrument's own state /
 * failure-streak row (last-writer-wins), which self-heals on the next run — the
 * lifecycle is idempotent and resumable by design (guardrail 7).
 */
async function kickBackfill(today: IsoDate, ticker: string): Promise<void> {
  const providerRegistry = registry(today);
  if (!providerRegistry.isServed("closes")) {
    return;
  }
  try {
    await runDaily(
      {
        repo: repository(),
        registry: providerRegistry,
        config: webConfig(),
        today,
        sleep: realSleep,
      },
      [ticker],
    );
  } catch (error) {
    console.error(
      `kick-on-add backfill for ${ticker} failed (deferred to cron)`,
      error,
    );
  }
}

export interface IngestionOutcome {
  /** Null when ingestion was skipped for lack of a "closes" provider. */
  report: DailyReport | null;
  /** Human-readable reason when report is null. */
  skipped: string | null;
}

/**
 * The daily ingestion pipeline (the cron route's body): run the throttled
 * daily refresh + backfill over the registered adapters (the Yahoo adapter
 * serves "closes"), across the UNION of every user's watchlist (item 021 —
 * each ticker fetched once; a ticker nobody tracks is not fetched). The skip
 * branch remains as defensive degradation: were no active provider to serve
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
  const union = await repository().getAllWatchlistedTickers();
  const report = await runDaily(
    {
      repo: repository(),
      registry: providerRegistry,
      config: webConfig(),
      today,
      sleep: realSleep,
    },
    union,
  );
  return { report, skipped: null };
}
