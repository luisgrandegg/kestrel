import { readFileSync } from "node:fs";
import type { Repository } from "../storage/repository.js";
import type { Instrument, IsoDate } from "../types/index.js";

/**
 * Watchlist (backlog item 011) — MVP.md §1: a user-defined list of tickers,
 * committed as a JSON file.
 *
 * Removal semantics (decision recorded on the backlog item): ingestion
 * drives off the intersection of the watchlist file and the instruments
 * table. A ticker removed from the file simply stops being synced — its
 * instruments row and all stored history remain untouched (append-only,
 * guardrail 3). No `archived` state, no schema migration.
 */

export const DEFAULT_WATCHLIST_PATH = "watchlist.json";

/** Load and validate the watchlist file: a JSON array of ticker strings. */
export function loadWatchlist(path = DEFAULT_WATCHLIST_PATH): string[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Watchlist file not readable: ${path}`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Watchlist file is not valid JSON: ${path}`, {
      cause: error,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Watchlist must be a JSON array of tickers: ${path}`);
  }
  const tickers: string[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(
        `Watchlist entries must be non-empty ticker strings, got: ${JSON.stringify(entry)}`,
      );
    }
    const ticker = entry.trim().toUpperCase();
    if (!seen.has(ticker)) {
      seen.add(ticker);
      tickers.push(ticker);
    }
  }
  return tickers;
}

/** Register watchlist tickers as `pending` instruments. Idempotent. */
export function registerWatchlist(
  repo: Repository,
  tickers: readonly string[],
  addedAt: IsoDate,
): void {
  for (const ticker of tickers) {
    repo.addInstrument(ticker, addedAt);
  }
}

/**
 * Instruments the daily run should touch: watchlist ∩ instruments, minus
 * `error` instruments (repeated failures stop consuming throttled calls
 * until someone intervenes). Removed tickers stop syncing; their history
 * stays.
 */
export function syncableInstruments(
  repo: Repository,
  watchlist: readonly string[],
): Instrument[] {
  const active = new Set(watchlist);
  return repo
    .listInstruments()
    .filter((i) => active.has(i.ticker) && i.state !== "error");
}
