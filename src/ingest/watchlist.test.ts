import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Repository } from "../storage/repository.js";
import {
  loadWatchlist,
  registerWatchlist,
  syncableInstruments,
} from "./watchlist.js";

const tempFile = (content: string): string => {
  const path = join(
    mkdtempSync(join(tmpdir(), "kestrel-watchlist-")),
    "watchlist.json",
  );
  writeFileSync(path, content);
  return path;
};

describe("loadWatchlist", () => {
  it("loads, trims, uppercases, and dedupes tickers, preserving order", () => {
    const path = tempFile(JSON.stringify(["aapl", " MSFT ", "AAPL", "bmw.de"]));
    expect(loadWatchlist(path)).toEqual(["AAPL", "MSFT", "BMW.DE"]);
  });

  it("an empty watchlist is valid", () => {
    expect(loadWatchlist(tempFile("[]"))).toEqual([]);
  });

  it("fails loudly on missing files, bad JSON, and bad entries", () => {
    expect(() => loadWatchlist("/nonexistent/watchlist.json")).toThrow(
      /not readable/,
    );
    expect(() => loadWatchlist(tempFile("{ not json"))).toThrow(
      /not valid JSON/,
    );
    expect(() => loadWatchlist(tempFile('{"tickers": []}'))).toThrow(
      /must be a JSON array/,
    );
    expect(() => loadWatchlist(tempFile('["AAPL", 42]'))).toThrow(
      /non-empty ticker strings/,
    );
    expect(() => loadWatchlist(tempFile('["AAPL", "  "]'))).toThrow(
      /non-empty ticker strings/,
    );
  });
});

describe("registerWatchlist + syncableInstruments", () => {
  it("registers tickers as pending; re-registering is a no-op", () => {
    const repo = new Repository(":memory:");
    registerWatchlist(repo, ["AAPL", "MSFT"], "2026-07-10");
    repo.setInstrumentState("AAPL", "ready");
    registerWatchlist(repo, ["AAPL", "MSFT"], "2026-07-12");
    expect(repo.getInstrument("AAPL")?.state).toBe("ready");
    expect(repo.getInstrument("AAPL")?.addedAt).toBe("2026-07-10");
    expect(repo.getInstrument("MSFT")?.state).toBe("pending");
  });

  it("a ticker removed from the watchlist is not picked up for syncing", () => {
    const repo = new Repository(":memory:");
    registerWatchlist(repo, ["AAPL", "MSFT"], "2026-07-10");
    // MSFT is later removed from the watchlist file.
    const syncable = syncableInstruments(repo, ["AAPL"]);
    expect(syncable.map((i) => i.ticker)).toEqual(["AAPL"]);
  });

  it("removal never deletes stored history", () => {
    const repo = new Repository(":memory:");
    registerWatchlist(repo, ["MSFT"], "2026-07-10");
    repo.insertCloses([{ ticker: "MSFT", date: "2026-07-10", close: 500 }]);
    // Removed from the watchlist: not syncable, but history stays readable.
    expect(syncableInstruments(repo, [])).toEqual([]);
    expect(repo.getCloses("MSFT")).toHaveLength(1);
    expect(repo.getInstrument("MSFT")).toBeDefined();
  });

  it("error instruments are excluded from syncing until someone intervenes", () => {
    const repo = new Repository(":memory:");
    registerWatchlist(repo, ["AAPL", "MSFT"], "2026-07-10");
    repo.setInstrumentState("MSFT", "error");
    expect(
      syncableInstruments(repo, ["AAPL", "MSFT"]).map((i) => i.ticker),
    ).toEqual(["AAPL"]);
  });
});
