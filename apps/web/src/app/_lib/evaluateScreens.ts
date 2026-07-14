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
 * Screen evaluation harness — the web composition root's twin of
 * apps/cli/src/app/evaluateScreens.ts (keep the two in sync). Duplicated
 * rather than shared because this harness is composition-root code — the
 * one kind of module allowed to import both screens/ and providers/
 * (registry) — and apps cannot import apps; hoisting it into a package
 * would force screens/ and providers/ to meet below the composition roots.
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

/** Read every ready instrument's evaluation inputs, bounded by asOf. */
export async function buildSnapshots(
  repo: StorageRepository,
  config: KestrelConfig,
  asOf: IsoDate,
): Promise<InstrumentSnapshot[]> {
  const instruments = await repo.listInstruments("ready");
  const snapshots: InstrumentSnapshot[] = [];
  for (const instrument of instruments) {
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
