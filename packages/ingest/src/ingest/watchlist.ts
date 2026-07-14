import type { StorageRepository } from "@kestrel/core/storage/port";
import type { Instrument, IsoDate } from "@kestrel/core/types";

/**
 * Watchlist helpers (backlog item 011; union source per item 021) — MVP.md
 * §1: the tickers to ingest. Since item 021 (ADR-0013) the source is the
 * UNION of every user's per-user watchlist (`user_watchlist`, behind the
 * storage port), not a committed JSON file — the composition root queries the
 * union and passes it here as a ticker list.
 *
 * Removal semantics (decision recorded on the backlog item): ingestion drives
 * off the intersection of the passed ticker list and the instruments table. A
 * ticker no user tracks simply drops out of the list and stops being synced —
 * its instruments row and all stored history remain untouched (append-only,
 * guardrail 3). No `archived` state, no schema migration.
 *
 * Ordering contract: a run calls `registerWatchlist` before
 * `syncableInstruments`; the latter fails loudly on listed-but-unregistered
 * tickers rather than silently never syncing them.
 */

/** Canonical ticker form used everywhere: trimmed, uppercase. */
export function normalizeTicker(raw: string): string {
  const ticker = raw.trim().toUpperCase();
  if (ticker === "") {
    throw new Error(
      `Ticker must be a non-empty string, got: ${JSON.stringify(raw)}`,
    );
  }
  return ticker;
}

/**
 * Register watchlist tickers as `pending` instruments. Idempotent.
 * Normalizes its inputs so a raw-cased caller can never create a duplicate
 * instrument row alongside the canonical one.
 */
export async function registerWatchlist(
  repo: StorageRepository,
  tickers: readonly string[],
  addedAt: IsoDate,
): Promise<void> {
  for (const ticker of tickers) {
    await repo.addInstrument(normalizeTicker(ticker), addedAt);
  }
}

/**
 * Watchlist instruments in sticky `error` state (skipped by runs; reported
 * so a dead watchlist is never silent — sticky-error decision on 011).
 */
export async function erroredInstruments(
  repo: StorageRepository,
  watchlist: readonly string[],
): Promise<Instrument[]> {
  const active = new Set(watchlist.map(normalizeTicker));
  const errored = await repo.listInstruments("error");
  return errored.filter((i) => active.has(i.ticker));
}

/**
 * Instruments the daily run should touch: watchlist ∩ instruments, minus
 * `error` instruments — see {@link erroredInstruments}, which runs report
 * for visibility.
 */
export async function syncableInstruments(
  repo: StorageRepository,
  watchlist: readonly string[],
): Promise<Instrument[]> {
  const active = new Set(watchlist.map(normalizeTicker));
  const instruments = await repo.listInstruments();
  const known = new Set(instruments.map((i) => i.ticker));
  const unregistered = [...active].filter((t) => !known.has(t));
  if (unregistered.length > 0) {
    throw new Error(
      `Watchlist tickers not registered as instruments: ${unregistered.join(", ")} — call registerWatchlist first`,
    );
  }
  return instruments.filter((i) => active.has(i.ticker) && i.state !== "error");
}
