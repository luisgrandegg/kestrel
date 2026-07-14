import { readFileSync } from "node:fs";
import type { StorageRepository } from "../storage/port.js";
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
 *
 * Ordering contract: a run calls `registerWatchlist` before
 * `syncableInstruments`; the latter fails loudly on listed-but-unregistered
 * tickers rather than silently never syncing them.
 */

/**
 * Resolved against process.cwd(): intended for repo-root invocation (the
 * scheduled Action). Other runners pass an explicit path (backlog 019).
 */
export const DEFAULT_WATCHLIST_PATH = "watchlist.json";

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
 * Load and validate the watchlist file: a JSON array of ticker strings.
 * (The read/parse ladder mirrors loadConfig in src/config — keep their
 * error-wrapping styles in sync.)
 */
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
    const ticker = normalizeTicker(entry);
    if (!seen.has(ticker)) {
      seen.add(ticker);
      tickers.push(ticker);
    }
  }
  return tickers;
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
