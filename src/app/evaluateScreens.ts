import type { KestrelConfig } from "../config/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { InstrumentSnapshot, Screen } from "../screens/screen.js";
import type { Repository } from "../storage/repository.js";
import type { Instrument, IsoDate, ScreenResolution } from "../types/index.js";

/**
 * Screen evaluation harness (backlog item 014) — the composition root that
 * may import both screens/ and providers/ (recorded on the backlog item;
 * the boundary lint pins src/app/ as the top of the graph).
 *
 * Given the repository and an explicit as-of date, it builds each ready
 * instrument's snapshot from storage (no-lookahead bounded reads), consults
 * the registry, and evaluates every ENABLED screen. Disabled screens are
 * reported with their missing capabilities — never silently skipped, never
 * fed fabricated data (guardrail 4). Driven only by stored data: no
 * provider fetches happen here (CONSTITUTION.md §2.2).
 */

export interface ScreenEvaluation<Match> {
  screenId: string;
  resolution: ScreenResolution;
  /** Matches with their supporting numbers; empty when disabled. */
  matches: Match[];
}

export function evaluateScreens<Match>(
  repo: Repository,
  registry: ProviderRegistry,
  config: KestrelConfig,
  screens: readonly Screen<Match>[],
  asOf: IsoDate,
): ScreenEvaluation<Match>[] {
  const snapshots = repo
    .listInstruments("ready")
    .map((instrument) => buildSnapshot(repo, config, instrument, asOf))
    .filter((s): s is InstrumentSnapshot => s !== null);

  return screens.map((screen) => {
    const resolution = registry.resolveScreen(screen.requiredCapabilities);
    if (!resolution.enabled) {
      return { screenId: screen.id, resolution, matches: [] };
    }
    const matches: Match[] = [];
    for (const snapshot of snapshots) {
      const match = screen.evaluate(snapshot, config);
      if (match !== null) {
        matches.push(match);
      }
    }
    return { screenId: screen.id, resolution, matches };
  });
}

/**
 * Read one instrument's evaluation inputs from storage, bounded by asOf.
 * An instrument with no close on or before asOf has no data in the
 * evaluation window (e.g. a backtest date before its history) — skipped.
 */
function buildSnapshot(
  repo: Repository,
  config: KestrelConfig,
  instrument: Instrument,
  asOf: IsoDate,
): InstrumentSnapshot | null {
  const latestClose = repo.latestClose(instrument.ticker, asOf);
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
    closes: repo.lastNCloses(
      instrument.ticker,
      config.fluctuation.lookbackTradingDays,
      asOf,
    ),
  };
}
