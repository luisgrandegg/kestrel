import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { utcIsoDate } from "./clock.js";
import { runDailyPipeline } from "./main.js";

/**
 * CLI entrypoint for the scheduled daily run (backlog item 019).
 *
 *   node dist/app/cli.js [dbPath] [watchlistPath] [dashboardPath] [configPath]
 *
 * The `new Date()` below is the one sanctioned wall-clock read in the
 * codebase: it becomes the run's UTC calendar date and is injected
 * downward — everything under src/ingest and src/app takes an explicit
 * IsoDate (guardrail 2).
 */
const [
  dbPath = "data/kestrel.db",
  watchlistPath = "watchlist.json",
  dashboardPath = "dashboard.md",
  configPath,
] = process.argv.slice(2);

const today = utcIsoDate(new Date());

mkdirSync(dirname(dbPath), { recursive: true });
const { dashboard } = await runDailyPipeline({
  dbPath,
  watchlistPath,
  configPath,
  today,
  log: console.log,
});

writeFileSync(
  dashboardPath,
  `# Kestrel dashboard\n\n\`\`\`\n${dashboard}\`\`\`\n`,
);
console.log(dashboard);
