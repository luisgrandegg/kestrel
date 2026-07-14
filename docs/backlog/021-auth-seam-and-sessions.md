# 021 — Auth seam + sessions (method-agnostic)

**Milestone:** M8 · **Depends on:** 020 · **Spec:** this item

## Goal

Sign-in/sign-out for `apps/web` where the authentication *method* sits
behind a seam — the same shape as the provider registry: concrete methods
plug in, everything else types against the contract, and a deployment
with no method configured degrades honestly instead of breaking.

## Scope

- **`AuthMethod` contract** (apps/web `_lib`, or a `packages/` home if it
  stays framework-free — decide by what it must import): an OAuth2/OIDC-
  shaped interface, roughly:
  ```
  id: string                      // "google", ...
  displayName: string             // for the sign-in page
  beginSignIn(state) → redirect URL
  handleCallback(params, state) → { provider, subject, email,
                                    emailVerified, displayName }
  ```
  The contract returns *identity claims*; mapping claims → user rows is
  the seam's job (via item 020's `UserStore`), never the method's.
- **Method registry**: configured methods only (a method whose env vars
  are absent is not offered). Zero methods configured → the current
  public behavior is preserved and the sign-in page states that no
  method is configured — mirroring the capability-gated screens
  (guardrail 4: visible degradation, never a broken flow).
- **Sessions**: HTTP-only, `Secure`, `SameSite=Lax` cookie carrying a
  signed session token (`SESSION_SECRET` env, fail-loud when auth is
  enabled but the secret is unset). Constant-time verification (reuse the
  digest-compare pattern from the cron guard). Absolute expiry +
  sliding renewal; sign-out clears the cookie.
- **Route protection**: when auth is enabled (≥1 method configured), the
  dashboard requires a session; unauthenticated requests are redirected
  to the sign-in page. `/api/ingest` is machine-auth (CRON_SECRET) and
  is NOT session-gated — unchanged.
- **CSRF/replay**: OAuth `state` parameter round-tripped through a
  short-lived cookie and verified on callback; PKCE where the method
  supports it (item 022 does).
- Tests: contract-level with a **fake AuthMethod** (the `providerWith`
  pattern) — sign-in redirect, callback → user created/linked via 020's
  open-question decisions, session issued/verified/expired/cleared,
  protected-route redirect, none-configured degradation. No live OAuth
  in tests.

## Open questions — decide before building

1. **Build vs adopt:** hand-rolled OIDC flow behind our own seam
   (recommended: the flow above is small, dependency-free, and the seam
   stays ours) vs Auth.js/NextAuth vs Supabase Auth (both bring their own
   session model and would BE the seam — faster, but the method-agnostic
   contract becomes theirs, and Supabase Auth couples auth to one
   engine). This is ADR material once decided.
2. **Lockdown default:** with ≥1 method configured, is the whole
   dashboard private (recommended — it is personal financial research),
   or public with sign-in only gating future per-user features?
3. **Session lifetime:** absolute/sliding durations (config keys, not
   constants — guardrail 5; suggest `auth.sessionHours` with a §9-style
   default recorded when decided).

## Acceptance criteria

- [ ] Fake-method test suite covers the full flow (redirect → callback →
      user row → session → protected route → sign-out).
- [ ] Zero-methods deployment renders the dashboard exactly as today and
      the sign-in page says no method is configured.
- [ ] Session cookie is HTTP-only/Secure/SameSite, signed, expiring;
      tampered or expired tokens are rejected (tests).
- [ ] `state` mismatch on callback is rejected loudly (test).
- [ ] `/api/ingest` behavior unchanged (CRON_SECRET only).
- [ ] Seam lint: pages stay presentation-only (`web-pages-render-only`
      still green); auth glue lives with the composition root.
