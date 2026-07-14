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
  it("normalizes raw-cased inputs so no duplicate rows or empty intersections arise", async () => {
    const repo = new Repository(":memory:");
    await registerWatchlist(repo, ["aapl"], "2026-07-10");
    expect(await repo.getInstrument("AAPL")).toBeDefined();
    expect(await repo.getInstrument("aapl")).toBeUndefined();
    expect(
      (await syncableInstruments(repo, [" aapl "])).map((i) => i.ticker),
    ).toEqual(["AAPL"]);
  });

  it("fails loudly on watchlist tickers that were never registered", async () => {
    const repo = new Repository(":memory:");
    await registerWatchlist(repo, ["AAPL"], "2026-07-10");
    await expect(syncableInstruments(repo, ["AAPL", "NVDA"])).rejects.toThrow(
      /not registered as instruments: NVDA — call registerWatchlist first/,
    );
  });

  it("registers tickers as pending; re-registering is a no-op", async () => {
    const repo = new Repository(":memory:");
    await registerWatchlist(repo, ["AAPL", "MSFT"], "2026-07-10");
    await repo.setInstrumentState("AAPL", "ready");
    await registerWatchlist(repo, ["AAPL", "MSFT"], "2026-07-12");
    expect((await repo.getInstrument("AAPL"))?.state).toBe("ready");
    expect((await repo.getInstrument("AAPL"))?.addedAt).toBe("2026-07-10");
    expect((await repo.getInstrument("MSFT"))?.state).toBe("pending");
  });

  it("a ticker removed from the watchlist is not picked up for syncing", async () => {
    const repo = new Repository(":memory:");
    await registerWatchlist(repo, ["AAPL", "MSFT"], "2026-07-10");
    // MSFT is later removed from the watchlist file.
    const syncable = await syncableInstruments(repo, ["AAPL"]);
    expect(syncable.map((i) => i.ticker)).toEqual(["AAPL"]);
  });

  it("removal never deletes stored history", async () => {
    const repo = new Repository(":memory:");
    await registerWatchlist(repo, ["MSFT"], "2026-07-10");
    await repo.insertCloses([
      { ticker: "MSFT", date: "2026-07-10", close: 500 },
    ]);
    // Removed from the watchlist: not syncable, but history stays readable.
    expect(await syncableInstruments(repo, [])).toEqual([]);
    expect(await repo.getCloses("MSFT")).toHaveLength(1);
    expect(await repo.getInstrument("MSFT")).toBeDefined();
  });

  it("error instruments are excluded from syncing until someone intervenes", async () => {
    const repo = new Repository(":memory:");
    await registerWatchlist(repo, ["AAPL", "MSFT"], "2026-07-10");
    await repo.setInstrumentState("MSFT", "error");
    expect(
      (await syncableInstruments(repo, ["AAPL", "MSFT"])).map((i) => i.ticker),
    ).toEqual(["AAPL"]);
  });
});
