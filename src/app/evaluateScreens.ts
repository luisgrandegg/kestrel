import type { KestrelConfig } from "../config/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { InstrumentSnapshot, Screen } from "../screens/screen.js";
import type { Repository } from "../storage/repository.js";
import type { Instrument, IsoDate, ScreenEvaluation } from "../types/index.js";

/**
 * Screen evaluation harness (backlog item 014) — the composition root that
 * may import both screens/ and providers/ (recorded on the backlog item;
 * the boundary lint pins src/app/ as the top of the graph).
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
 * changed after that date. Fine for the MVP dashboard; a limitation for
 * point-in-time backtests.
 *
 * The split into buildSnapshots + evaluateScreen lets a caller with
 * heterogeneous screens (the three categories have distinct match shapes)
 * evaluate each screen with its own Match type over ONE set of snapshots —
 * no union casts, no repeated I/O. evaluateScreens is the convenience
 * wrapper for a homogeneous list.
 */

/** Read every ready instrument's evaluation inputs, bounded by asOf. */
export function buildSnapshots(
  repo: Repository,
  config: KestrelConfig,
  asOf: IsoDate,
): InstrumentSnapshot[] {
  return repo
    .listInstruments("ready")
    .map((instrument) => buildSnapshot(repo, config, instrument, asOf))
    .filter((s): s is InstrumentSnapshot => s !== null);
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
 * Convenience wrapper: evaluate a homogeneous list of screens. Snapshots
 * are only read from storage when at least one screen is enabled — a fully
 * disabled run does no per-instrument I/O.
 */
export function evaluateScreens<Match>(
  repo: Repository,
  registry: ProviderRegistry,
  config: KestrelConfig,
  screens: readonly Screen<Match>[],
  asOf: IsoDate,
): ScreenEvaluation<Match>[] {
  const anyEnabled = screens.some(
    (screen) => registry.resolveScreen(screen.requiredCapabilities).enabled,
  );
  const snapshots = anyEnabled ? buildSnapshots(repo, config, asOf) : [];
  return screens.map((screen) => evaluateScreen(snapshots, registry, screen));
}

/**
 * Read one instrument's evaluation inputs from storage, bounded by asOf.
 * An instrument with no close on or before asOf has no data in the
 * evaluation window (e.g. a backtest date before its history) — skipped.
 * The latest close is the tail of the lookback window (lookbackTradingDays
 * is validated >= 2), not a separate query.
 */
function buildSnapshot(
  repo: Repository,
  config: KestrelConfig,
  instrument: Instrument,
  asOf: IsoDate,
): InstrumentSnapshot | null {
  const closes = repo.lastNCloses(
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
    analyst: repo.latestAnalystSnapshot(instrument.ticker, asOf) ?? null,
    earnings: repo.latestEarningsSnapshot(instrument.ticker, asOf) ?? null,
    dividend: repo.latestDividendSnapshot(instrument.ticker, asOf) ?? null,
    closes,
  };
}
