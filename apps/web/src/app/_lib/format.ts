/**
 * Number formatting for the §8 dashboard rows — the web twin of the two
 * formatters at the bottom of apps/cli/src/ui/dashboard.ts (keep in sync;
 * both are pinned by tests). Deliberately duplicated: six lines of pure
 * presentation do not justify a shared package.
 */

/** Implied upside as a percentage with one decimal, e.g. 0.25 → "25.0%". */
export function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Native-currency price; "?" when no provider has reported a currency. */
export function money(value: number, currency: string | null): string {
  return `${value.toFixed(2)} ${currency ?? "?"}`;
}
