import type { IsoDate } from "@kestrel/core/types";
import type { Provider } from "./provider.js";
import { YahooProvider } from "./yahoo/yahoo.js";

/**
 * The active provider set for real runs — the one place adapters are
 * registered. Lives in @kestrel/ingest (not an app) because the web app's
 * composition roots — the dashboard page and the cron route (apps/web,
 * ADR-0011) — share the same single registration point, and it belongs to
 * the ingestion library rather than any one entrypoint.
 *
 * The MVP registers the one Yahoo adapter (ADR-0008), which serves all four
 * capabilities plus the instrument currency that travels with `closes`, so
 * every screen lights up. The adapter reads no wall clock: the run date is
 * injected as `today` (ADR-0012 decision 1) — the same UTC calendar date the
 * composition root derives and passes to ingestion — and stamps every
 * snapshot's `asOf` (guardrail 2).
 */
export function activeProviders(today: () => IsoDate): Provider[] {
  return [new YahooProvider({ today })];
}
