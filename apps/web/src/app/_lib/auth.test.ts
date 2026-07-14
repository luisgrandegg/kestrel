import type { AuthConfig } from "@kestrel/core/config";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { authOptions, configuredAuthMethods, isAuthorized } from "./auth";

const authConfig: AuthConfig = {
  sessionAbsoluteHours: 240,
  sessionSlidingHours: 24,
};

/** A pool object is only stored on `database`; never connected in these tests. */
const fakePool = new pg.Pool();

describe("configuredAuthMethods (honest method gating, item 020)", () => {
  it("offers no method when Google's env vars are absent", () => {
    expect(configuredAuthMethods({})).toEqual([]);
  });

  it("does not offer Google when only one of the two secrets is set", () => {
    expect(configuredAuthMethods({ GOOGLE_CLIENT_ID: "id" })).toEqual([]);
    expect(configuredAuthMethods({ GOOGLE_CLIENT_SECRET: "secret" })).toEqual(
      [],
    );
  });

  it("offers Google when both secrets are present", () => {
    expect(
      configuredAuthMethods({
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      }),
    ).toEqual(["google"]);
  });
});

describe("authOptions (ADR-0013 behaviors from config, item 020)", () => {
  it("maps session durations from config: expiresIn=absolute, updateAge=sliding (hours→seconds)", () => {
    const options = authOptions({ authConfig, database: fakePool, env: {} });
    expect(options.session?.expiresIn).toBe(240 * 3600);
    expect(options.session?.updateAge).toBe(24 * 3600);
  });

  it("enables verified-email account linking without trusting unverified providers", () => {
    const options = authOptions({ authConfig, database: fakePool, env: {} });
    expect(options.account?.accountLinking?.enabled).toBe(true);
    // No trustedProviders → link only on a provider-VERIFIED email (ADR-0013).
    expect(options.account?.accountLinking?.trustedProviders).toBeUndefined();
  });

  it("leaves signup open (no disableSignUp / disableImplicitLinking)", () => {
    const options = authOptions({
      authConfig,
      database: fakePool,
      env: { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" },
    });
    expect(options.account?.accountLinking?.disableImplicitLinking).toBeFalsy();
    const google = (options.socialProviders as { google?: unknown }).google as
      | { disableSignUp?: boolean }
      | undefined;
    expect(google?.disableSignUp).toBeFalsy();
  });

  it("registers Google only when configured, wiring the env secrets through", () => {
    const withoutGoogle = authOptions({
      authConfig,
      database: fakePool,
      env: {},
    });
    expect(withoutGoogle.socialProviders).toEqual({});

    const withGoogle = authOptions({
      authConfig,
      database: fakePool,
      env: { GOOGLE_CLIENT_ID: "the-id", GOOGLE_CLIENT_SECRET: "the-secret" },
    });
    expect(withGoogle.socialProviders).toEqual({
      google: { clientId: "the-id", clientSecret: "the-secret" },
    });
  });

  it("passes the database handle through as better-auth's own adapter", () => {
    const options = authOptions({ authConfig, database: fakePool, env: {} });
    expect(options.database).toBe(fakePool);
  });
});

describe("cron-route guard", () => {
  it("accepts exactly the Vercel Cron bearer header", () => {
    expect(isAuthorized("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isAuthorized(null, "s3cret")).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(isAuthorized("Bearer nope", "s3cret")).toBe(false);
  });

  it("rejects a bare secret without the Bearer scheme", () => {
    expect(isAuthorized("s3cret", "s3cret")).toBe(false);
  });

  it("would match a bare 'Bearer ' header against an empty secret — which is exactly why the handler 500s on an unset/empty secret BEFORE calling this guard", () => {
    expect(isAuthorized("Bearer ", "")).toBe(true);
  });
});
