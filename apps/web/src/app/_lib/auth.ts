import { createHash, timingSafeEqual } from "node:crypto";
import type { AuthConfig } from "@kestrel/core/config";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import pg from "pg";
import { webConfig } from "./pipeline";

/**
 * Cron-route guard, extracted as a pure function so it is unit-testable
 * without a running server. Vercel Cron invokes the ingest route with
 * `Authorization: Bearer ${CRON_SECRET}`; anything else is rejected. The
 * caller must have already established that `secret` is non-empty — an
 * unset secret is a 500 at the handler edge, never an open route. This is
 * MACHINE auth for the cron route and is deliberately independent of the
 * user sign-in below: `/api/ingest` stays CRON_SECRET-gated, never
 * session-gated (item 020).
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

/**
 * The authentication seam (backlog item 020, ADR-0013): better-auth is the
 * method-agnostic sign-in layer. It owns its OWN tables (`user`/`session`/
 * `account`/`verification`) and reaches Postgres through its OWN adapter —
 * a `pg.Pool` handed straight to better-auth's built-in (Kysely) Postgres
 * adapter. That sits BESIDE our `StorageRepository` seam, not behind it: a
 * documented exception to `only-storage-touches-the-database`, precedented
 * by the composition-root pg.Pool driver adapter (ADR-0011/0013). Both live
 * here in src/app/, the one place the lint rule permits touching `pg`.
 *
 * Google is the only method for now (more are plugin additions later). It is
 * offered only when its env vars are present — by analogy to guardrail 4's
 * honest degradation for capability-gated screens, a method whose secrets
 * are absent is simply not offered rather than presented as broken.
 */

export type AuthMethod = "google";

/**
 * Which sign-in methods are actually configured, given the environment.
 * Empty when none are — the sign-in page renders an honest "no method
 * configured" state rather than a broken button (item 020; guardrail 4 by
 * analogy). Pure over its `env` argument so it is unit-testable.
 */
export function configuredAuthMethods(
  env: Record<string, string | undefined> = process.env,
): AuthMethod[] {
  const methods: AuthMethod[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    methods.push("google");
  }
  return methods;
}

/**
 * Build the better-auth options from our config + environment, as a pure
 * function so the session mapping and method gating are unit-testable
 * without constructing a live instance or touching a database.
 *
 * Session durations come from config (guardrail 5), never constants. Our
 * two keys map onto better-auth's two native session knobs:
 *
 *   - `expiresIn`  ← auth.sessionAbsoluteHours  (the sliding window length:
 *                    on refresh, expiry is set to now + expiresIn)
 *   - `updateAge`  ← auth.sessionSlidingHours   (the refresh threshold: the
 *                    session slides forward once it is older than this)
 *
 * better-auth models a session as a single SLIDING window (no separate
 * hard-absolute cap): a session unused for `expiresIn` expires, and each use
 * past `updateAge` extends it. `sessionSlidingHours <= sessionAbsoluteHours`
 * is enforced in config, which is exactly better-auth's `updateAge <=
 * expiresIn` requirement. A stricter absolute-since-first-login cap is not
 * offered natively and is left as future work (ADR-0013 already defers
 * cost/abuse bounding).
 *
 * Account linking is enabled (better-auth's default) WITHOUT trustedProviders,
 * so a new identity links to an existing user only when the provider reports
 * the email as VERIFIED (ADR-0013). Auto-create on first sign-in and open
 * signup are better-auth defaults — `disableSignUp`/`disableImplicitLinking`
 * are deliberately left unset.
 */
export function authOptions(params: {
  authConfig: AuthConfig;
  database: pg.Pool;
  env?: Record<string, string | undefined>;
}): BetterAuthOptions {
  const env = params.env ?? process.env;
  const methods = configuredAuthMethods(env);
  const socialProviders = methods.includes("google")
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID as string,
          clientSecret: env.GOOGLE_CLIENT_SECRET as string,
        },
      }
    : {};

  return {
    database: params.database,
    // Optional in config; better-auth also reads BETTER_AUTH_URL /
    // BETTER_AUTH_SECRET from the environment itself. Passed through so the
    // options object is self-describing for tests.
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders,
    account: { accountLinking: { enabled: true } },
    session: {
      expiresIn: params.authConfig.sessionAbsoluteHours * 3600,
      updateAge: params.authConfig.sessionSlidingHours * 3600,
    },
    // Must be last (better-auth/next-js): propagates Set-Cookie from auth
    // methods invoked in Server Actions / route handlers.
    plugins: [nextCookies()],
  };
}

let pool: pg.Pool | undefined;
let instance: ReturnType<typeof betterAuth> | undefined;

/**
 * better-auth's dedicated Postgres pool — separate from the storage seam's
 * pool (db.ts) so auth truly owns its DB access (ADR-0013). Lazy: nothing
 * reads DATABASE_URL at import time, so `next build` succeeds without it and
 * the fail-loud check runs on first use (guardrail 6), not at build.
 */
function authPool(): pg.Pool {
  if (pool === undefined) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set — better-auth needs the Supabase Postgres " +
          "connection string (see docs/deploy.md)",
      );
    }
    pool = new pg.Pool({ connectionString });
    pool.on("error", (error) => {
      console.error("auth pg pool: idle client error (evicted)", error);
    });
  }
  return pool;
}

/**
 * The lazily-constructed better-auth instance. Built on first request, never
 * at import/build time (better-auth throws on a missing production secret —
 * that is the runtime fail-loud we want, not a build break).
 */
export function getAuth(): ReturnType<typeof betterAuth> {
  if (instance === undefined) {
    instance = betterAuth(
      authOptions({ authConfig: webConfig().auth, database: authPool() }),
    );
  }
  return instance;
}
