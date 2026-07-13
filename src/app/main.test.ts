import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Provider } from "../providers/provider.js";
import { Repository } from "../storage/repository.js";
import type { DailyClose } from "../types/index.js";
import { runDailyPipeline } from "./main.js";

const TODAY = "2026-07-31";

/** The pinned §5.2 volatile series as provider data: 4 fluctuations. */
const SERIES: DailyClose[] = [100, 112, 98, 113, 99, 114].map((close, i) => ({
  ticker: "ACME",
  date: `2026-07-2${i + 1}`,
  close,
}));

/** A closes+analyst provider serving the fixture series, counting calls. */
const fakeProvider = (): Provider & { calls: () => number } => {
  let calls = 0;
  return {
    id: "fake",
    capabilities: new Set(["closes", "analystTargets"]),
    getCloses: (ticker, from, to) => {
      calls += 1;
      return Promise.resolve(
        SERIES.filter((c) => c.date >= from && c.date <= to).map((c) => ({
          ...c,
          ticker,
        })),
      );
    },
    getAnalystTargets: (ticker) => {
      calls += 1;
      return Promise.resolve({
        ticker,
        asOf: TODAY,
        medianTarget: 142.5, // vs latest close 114: exactly 25% upside
        numAnalysts: 8,
      });
    },
    calls: () => calls,
  };
};

/** Write watchlist + config-override fixtures; return explicit paths. */
const setupDir = (): { db: string; watchlist: string; config: string } => {
  const dir = mkdtempSync(join(tmpdir(), "kestrel-main-"));
  const watchlist = join(dir, "watchlist.json");
  writeFileSync(watchlist, JSON.stringify(["ACME"]));
  const config = join(dir, "config.json");
  // Lookback = the fixture's six closes: promotes to ready in one run AND
  // the fluctuation window spans the whole series (4 completed swings).
  writeFileSync(
    config,
    JSON.stringify({ fluctuation: { lookbackTradingDays: 6 } }),
  );
  return { db: join(dir, "kestrel.db"), watchlist, config };
};

const instantSleep = (): Promise<void> => Promise.resolve();

describe("runDailyPipeline — the scheduled entrypoint (backlog 019)", () => {
  it("ingests, promotes, and renders from stored data; a same-day re-run changes nothing", async () => {
    const paths = setupDir();
    const provider = fakeProvider();
    const options = {
      dbPath: paths.db,
      watchlistPath: paths.watchlist,
      configPath: paths.config,
      today: TODAY,
      providers: [provider],
      sleep: instantSleep,
    };

    // Run 1: ACME registers pending, backfills to ready (closes AND
    // metadata land during backfill), and the row renders immediately.
    const first = await runDailyPipeline(options);
    expect(first.report?.backfill.promoted).toEqual(["ACME"]);
    expect(first.dashboard).toMatch(/ACME[ ]+25\.0%/);

    // Run 2 (same day): ready now, but run 1's backfill already stamped
    // both sync markers for today — the once-per-day dedupe means this
    // run fetches nothing and just re-renders the same stored world.
    const second = await runDailyPipeline(options);
    expect(second.report?.metadataRefreshed).toEqual([]);
    expect(second.dashboard).toMatch(/ACME[ ]+25\.0%/);

    // Run 3 (re-triggered same day): observably idempotent end-to-end —
    // zero provider calls (same-day dedupe), identical stored data,
    // identical dashboard.
    const callsBefore = provider.calls();
    const third = await runDailyPipeline(options);
    expect(provider.calls()).toBe(callsBefore);
    expect(third.report?.backfill.processed).toEqual([]);
    expect(third.dashboard).toBe(second.dashboard);
    const repo = new Repository(paths.db);
    try {
      expect(repo.getCloses("ACME")).toHaveLength(SERIES.length);
    } finally {
      repo.close();
    }
  });

  it("with no provider serving closes, skips ingestion and renders every screen disabled", async () => {
    const paths = setupDir();
    const lines: string[] = [];
    const { dashboard, report } = await runDailyPipeline({
      dbPath: paths.db,
      watchlistPath: paths.watchlist,
      configPath: paths.config,
      today: TODAY,
      providers: [],
      sleep: instantSleep,
      log: (line) => lines.push(line),
    });

    expect(report).toBeNull();
    expect(lines.join("\n")).toContain("ingestion skipped");
    // Never fabricated: all three screens visibly disabled.
    expect(dashboard).toContain("unavailable — missing capability: closes");
    expect(dashboard).toContain("earningsCalendar");
    expect(dashboard).toContain("dividendCalendar");
  });
});
