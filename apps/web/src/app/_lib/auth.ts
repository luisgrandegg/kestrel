/**
 * Cron-route guard, extracted as a pure function so it is unit-testable
 * without a running server. Vercel Cron invokes the ingest route with
 * `Authorization: Bearer ${CRON_SECRET}`; anything else is rejected. The
 * caller must have already established that `secret` is non-empty — an
 * unset secret is a 500 at the handler edge, never an open route.
 */
export function isAuthorized(
  authorizationHeader: string | null,
  secret: string,
): boolean {
  return authorizationHeader === `Bearer ${secret}`;
}
