import type { Provider } from "./provider.js";

/**
 * The active provider set for real runs — the one place adapters are
 * registered. Lives in @kestrel/ingest (not an app) because BOTH
 * composition roots — the CLI (apps/cli) and the web app's cron route
 * (apps/web, ADR-0011) — need the same single registration point, and
 * apps cannot import each other. Empty until the Yahoo adapter (backlog
 * item 010, pending spec decisions) lands: with no provider serving
 * "closes" the pipeline skips ingestion and every screen renders as
 * disabled with its missing capabilities — visible degradation, never
 * fabricated data (guardrail 4).
 */
export function activeProviders(): Provider[] {
  return [];
}
