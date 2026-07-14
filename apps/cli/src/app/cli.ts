import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { utcIsoDate } from "@kestrel/core/types/guards";
import { runDailyPipeline } from "./main.js";

/**
 * CLI entrypoint for the scheduled daily run (backlog item 019).
 *
 *   node apps/cli/dist/cli.js [dbPath] [watchlistPath] [dashboardPath] [configPath]
 *
 * The `new Date()` below is one of the sanctioned wall-clock reads in the
 * codebase — they live only in the composition-root entrypoints (this CLI
 * and apps/web's page/route handlers): it becomes the run's UTC calendar
 * date and is injected downward — everything under @kestrel/ingest and
 * app/ takes an explicit IsoDate (guardrail 2).
 */
const [
  dbPath = "data/kestrel.db",
  watchlistPath = "watchlist.json",
  dashboardPath = "dashboard.md",
  configArg,
] = process.argv.slice(2);

// Resolve the config source HERE, explicitly and observably — relying on
// loadConfig's cwd-relative implicit default from a non-repo-root cwd
// would silently present §9 defaults as the user's tuned thresholds.
const configPath =
  configArg ??
  (existsSync("kestrel.config.json") ? "kestrel.config.json" : undefined);
console.log(`config: ${configPath ?? "§9 defaults (no override file)"}`);

const today = utcIsoDate(new Date());

mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(dirname(dashboardPath), { recursive: true });
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
