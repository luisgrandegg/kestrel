/**
 * Number formatting for the §8 dashboard rows — pure presentation helpers
 * pinned by tests. The single home for the dashboard's number formatting
 * now that apps/web is the only composition root.
 */

/** Implied upside as a percentage with one decimal, e.g. 0.25 → "25.0%". */
export function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Native-currency price; "?" when no provider has reported a currency. */
export function money(value: number, currency: string | null): string {
  return `${value.toFixed(2)} ${currency ?? "?"}`;
}
