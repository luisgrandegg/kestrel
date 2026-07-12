/**
 * Shared fail-loud numeric guards for the metrics layer.
 *
 * Metrics must never produce a silent wrong answer from malformed input
 * (CONSTITUTION.md §5) — these throw RangeError at the metric boundary.
 */

export function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${name} must be a positive finite number, got: ${value}`,
    );
  }
}

export function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${name} must be a non-negative integer, got: ${value}`,
    );
  }
}
