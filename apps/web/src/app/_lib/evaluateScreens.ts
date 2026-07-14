import type { KestrelConfig } from "@kestrel/core/config";
import type { InstrumentSnapshot, Screen } from "@kestrel/core/screens/screen";
import type { StorageRepository } from "@kestrel/core/storage/port";
import type {
  Instrument,
  IsoDate,
  ScreenEvaluation,
} from "@kestrel/core/types";
import type { ProviderRegistry } from "@kestrel/ingest/providers/registry";

/**
 * Screen evaluation harness — composition-root code: the one kind of module
 * allowed to import both screens/ and providers/ (registry). It stays here
 * in apps/web (the sole composition root) rather than in a package, so
 * screens/ and providers/ never meet below the composition root.
 *
 * Given the repository and an explicit as-of date, it builds each ready
 * instrument's snapshot from storage, consults the registry, and evaluates
 * every ENABLED screen. Disabled screens are reported with their missing
 * capabilities — never silently skipped, never fed fabricated data
 * (guardrail 4). Driven only by stored data: no provider fetches happen
 * here (CONSTITUTION.md §2.2).
 *
 * As-of semantics: every OBSERVATION read (closes, snapshots) is bounded by
 * asOf — no lookahead. The INSTRUMENT SET, however, reflects current
 * lifecycle state (`ready` is mutable ingestion bookkeeping with no as-of
 * history), so a historical evaluation omits instruments whose state
 * changed after that date.
 */

/**
 * Read ready instruments' evaluation inputs, bounded by asOf. When
 * `allowedTickers` is given, only those tickers are evaluated — the per-user
 * watchlist filter (item 021): the shared market data drives the metrics, but
 * the ticker SET is the requesting user's. Undefined means every ready
 * instrument (used by non-user-scoped callers/tests).
 */
export async function buildSnapshots(
  repo: StorageRepository,
  config: KestrelConfig,
  asOf: IsoDate,
  allowedTickers?: readonly string[],
): Promise<InstrumentSnapshot[]> {
  const allowed =
    allowedTickers === undefined ? undefined : new Set(allowedTickers);
  const instruments = await repo.listInstruments("ready");
  const snapshots: InstrumentSnapshot[] = [];
  for (const instrument of instruments) {
    if (allowed !== undefined && !allowed.has(instrument.ticker)) {
      continue;
    }
    const snapshot = await buildSnapshot(repo, config, instrument, asOf);
    if (snapshot !== null) {
      snapshots.push(snapshot);
    }
  }
  return snapshots;
}

/** Resolve one screen against the registry and evaluate it if enabled. */
export function evaluateScreen<Match>(
  snapshots: readonly InstrumentSnapshot[],
  registry: ProviderRegistry,
  screen: Screen<Match>,
): ScreenEvaluation<Match> {
  const resolution = registry.resolveScreen(screen.requiredCapabilities);
  if (!resolution.enabled) {
    return { screenId: screen.id, resolution, matches: [] };
  }
  const matches = snapshots
    .map((snapshot) => screen.evaluate(snapshot))
    .filter((match): match is Match => match !== null);
  return { screenId: screen.id, resolution, matches };
}

/**
 * Read one instrument's evaluation inputs from storage, bounded by asOf.
 * An instrument with no close on or before asOf has no data in the
 * evaluation window — skipped. The latest close is the tail of the
 * lookback window (lookbackTradingDays is validated >= 2), not a separate
 * query.
 */
async function buildSnapshot(
  repo: StorageRepository,
  config: KestrelConfig,
  instrument: Instrument,
  asOf: IsoDate,
): Promise<InstrumentSnapshot | null> {
  const closes = await repo.lastNCloses(
    instrument.ticker,
    config.fluctuation.lookbackTradingDays,
    asOf,
  );
  const latestClose = closes[closes.length - 1];
  if (latestClose === undefined) {
    return null;
  }
  return {
    ticker: instrument.ticker,
    currency: instrument.currency,
    asOf,
    latestClose,
    analyst:
      (await repo.latestAnalystSnapshot(instrument.ticker, asOf)) ?? null,
    earnings:
      (await repo.latestEarningsSnapshot(instrument.ticker, asOf)) ?? null,
    dividend:
      (await repo.latestDividendSnapshot(instrument.ticker, asOf)) ?? null,
    closes,
  };
}
