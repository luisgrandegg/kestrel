import type { Provider } from "../providers/provider.js";

/**
 * The active provider set for real runs — the one place adapters are
 * registered (composition root). Empty until the Yahoo adapter (backlog
 * item 010, pending spec decisions) lands: with no provider serving
 * "closes" the pipeline skips ingestion and every screen renders as
 * disabled with its missing capabilities — visible degradation, never
 * fabricated data (guardrail 4).
 */
export function activeProviders(): Provider[] {
  return [];
}
