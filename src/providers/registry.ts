import type { Capability } from "../types/index.js";
import { CAPABILITY_METHODS, type Provider } from "./provider.js";

/**
 * Capability registry (backlog item 009) — the core contract of
 * CONSTITUTION.md §2.1: providers advertise capabilities, screens declare
 * required capabilities, and this registry resolves between them at
 * runtime. A screen whose required capabilities are not all served is
 * disabled with the missing capabilities named — never silently skipped.
 */

export type ScreenResolution =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly missing: readonly Capability[] };

export class ProviderRegistry {
  private readonly providers: readonly Provider[];

  /**
   * @param providers active providers; their order defines priority when
   * several serve the same capability.
   */
  constructor(providers: readonly Provider[]) {
    const seen = new Set<string>();
    for (const provider of providers) {
      if (seen.has(provider.id)) {
        throw new Error(`Duplicate provider id: "${provider.id}"`);
      }
      seen.add(provider.id);
      for (const capability of provider.capabilities) {
        if (typeof provider[CAPABILITY_METHODS[capability]] !== "function") {
          throw new Error(
            `Provider "${provider.id}" advertises "${capability}" but does not implement ${CAPABILITY_METHODS[capability]}()`,
          );
        }
      }
    }
    this.providers = [...providers];
  }

  /** Active providers serving a capability, in priority order. */
  providersFor(capability: Capability): Provider[] {
    return this.providers.filter((p) => p.capabilities.has(capability));
  }

  isServed(capability: Capability): boolean {
    return this.providers.some((p) => p.capabilities.has(capability));
  }

  /**
   * Resolve a screen's required capabilities: enabled only when every one
   * is served by some active provider; otherwise disabled with every
   * missing capability named (CONSTITUTION.md §2.1, guardrail 4).
   */
  resolveScreen(required: readonly Capability[]): ScreenResolution {
    const missing = required.filter((c) => !this.isServed(c));
    return missing.length === 0
      ? { enabled: true }
      : { enabled: false, missing };
  }
}
