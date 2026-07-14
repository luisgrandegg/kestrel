# 022 — Google authentication

**Milestone:** M8 · **Depends on:** 021 · **Spec:** this item

## Goal

The first concrete `AuthMethod`: sign in with Google. Proves the item-021
seam the way the Yahoo adapter proves the provider seam — if adding
Google touches anything outside the method adapter and its registration,
the seam failed.

## Scope

- **Google OIDC adapter** implementing `AuthMethod`:
  - Authorization-code flow **with PKCE**; scopes `openid email profile`.
  - Callback verifies the `id_token` against Google's published JWKS
    (issuer, audience, expiry, nonce) — fail loud on any mismatch, never
    "best effort" (guardrail 6 applied to the auth edge).
  - Maps claims → `{ provider: "google", subject: sub, email,
    emailVerified: email_verified, displayName: name }`. `sub` is the
    stable key — NEVER email (emails change; `sub` does not).
- **Configuration**: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` env vars;
  method registers itself only when both are present (item 021's
  configured-methods rule).
- **Access control**: `AUTH_ALLOWED_EMAILS` (comma-separated, normalized)
  — this is a personal app on a public URL; without an allowlist,
  "sign in with Google" means *anyone with a Google account*. A verified
  email not on the list is rejected with a clear screen and NO user row
  is created.
- **Docs**: extend `docs/deploy.md` — Google Cloud OAuth client setup,
  authorized redirect URI (`https://<app>/api/auth/callback/google` and
  the localhost twin), the three env vars, allowlist semantics.
- Tests: adapter-level with recorded/stubbed JWKS + token responses (no
  live Google in CI): happy path, bad issuer/audience/signature/nonce
  each rejected, unverified email rejected, allowlist enforcement.
  Registration test: adapter absent without its env vars.

## Open questions — decide before building

1. **Allowlist storage:** env var (recommended for one-or-two users;
   zero schema) vs a column/flag on `users` (needed anyway if
   provisioning ever becomes owner-managed — see item 020 Q1)?

## Acceptance criteria

- [ ] Full sign-in with Google works end-to-end on a deployed preview
      (manual check recorded on the PR).
- [ ] All id_token verification failure modes rejected loudly (tests).
- [ ] Allowlist enforced BEFORE user creation; rejected sign-ins leave no
      rows (test).
- [ ] Google specifics appear nowhere outside the adapter module and its
      env-conditional registration (grep + seam-lint probe, the
      no-provider-library-outside-providers pattern applied to auth).
- [ ] With Google's env vars absent, the app behaves exactly as item
      021's zero-methods state.
