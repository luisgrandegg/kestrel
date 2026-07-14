import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Cron-route guard, extracted as a pure function so it is unit-testable
 * without a running server. Vercel Cron invokes the ingest route with
 * `Authorization: Bearer ${CRON_SECRET}`; anything else is rejected. The
 * caller must have already established that `secret` is non-empty — an
 * unset secret is a 500 at the handler edge, never an open route.
 *
 * Comparison is constant-time over SHA-256 digests: hashing first gives
 * both sides equal length, so neither content nor length leaks through
 * timing. (With a long random secret a remote timing attack is not
 * practical anyway — this is cheap hardening on the app's one
 * security-sensitive comparison, not a load-bearing defense.)
 */
export function isAuthorized(
  authorizationHeader: string | null,
  secret: string,
): boolean {
  if (authorizationHeader === null) {
    return false;
  }
  const digest = (value: string): Buffer =>
    createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(
    digest(authorizationHeader),
    digest(`Bearer ${secret}`),
  );
}
