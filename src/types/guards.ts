/**
 * Shared fail-loud numeric guards (CONSTITUTION.md §5) — usable from any
 * layer. This module (like everything in types/) imports nothing: the
 * boundary lint pins types/ as a pure leaf so pure layers can never reach
 * I/O transitively through it.
 */

export function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${name} must be a positive finite number, got: ${value}`,
    );
  }
}

export function assertIntegerAtLeast(
  name: string,
  value: number,
  min: number,
): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer >= ${min}, got: ${value}`);
  }
}

export function assertNonNegativeInteger(name: string, value: number): void {
  assertIntegerAtLeast(name, value, 0);
}
