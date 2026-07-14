# 020 — Auth via better-auth (users, Google, private dashboard)

**Milestone:** M8 · **Depends on:** deploy PRs (apps/web, Postgres) · **Spec:** this item + ADR-0013 (supersedes the earlier hand-rolled-OIDC draft)

## Goal

Real users signing into `apps/web` with Google, via **better-auth** — the
method-agnostic seam (more providers later are plugin additions). The
dashboard becomes private: signed-in users only.

## Scope

- **better-auth** wired into `apps/web`, backed by Supabase Postgres
  through its own adapter. It owns `user`/`session`/`account`/
  `verification` — auth's tables sit BESIDE our storage seam, not behind
  it (ADR-0013; a documented exception to `only-storage-touches-the-
  database`, precedented by the composition-root `pg.Pool` adapter). Its
  migrations are applied alongside `supabase/migrations/`.
- **Google provider**, enabled only when `GOOGLE_CLIENT_ID` +
  `GOOGLE_CLIENT_SECRET` are present (a method whose env vars are absent is
  not offered) — applying, by analogy, the same honest-degradation
  principle guardrail 4 sets for capability-gated screens. Zero methods
  configured → the sign-in page says so; no broken flow.
- **Provisioning + linking** (ADR-0013): auto-create a user on first
  successful sign-in; a new identity whose provider-verified email matches
  an existing user links to that user.
- **Open signup** — anyone who can sign in gets an account (no allowlist;
  a stranger sees only their own empty dashboard once per-user data lands
  in item 021).
- **Sessions**: better-auth's signed HTTP-only cookie; durations from
  config, not constants (guardrail 5) — `auth.sessionAbsoluteHours` (720)
  and `auth.sessionSlidingHours` (168), recorded in the §9 defaults.
- **Route protection**: the dashboard page requires a session;
  unauthenticated requests redirect to sign-in. `/api/ingest` stays
  machine-auth (CRON_SECRET) — NOT session-gated.
- **Not yet**: per-user watchlists (item 021) — at the end of THIS item a
  signed-in user still sees the shared `watchlist.json` screens.

## Acceptance criteria

- [ ] **(manual — verify on the deployed preview)** Google sign-in works
      end-to-end; `sub` is the stable identity key, never email. Holds by
      construction — better-auth keys the account row on the provider `sub`
      (`accountId`) and links by verified email, never by email as identity —
      but the live round-trip to Google can only be exercised on a real
      preview (no Google reachability in CI/sandbox).
- [x] Auto-create + email-link behave per ADR-0013. The switches that
      produce this — `account.accountLinking.enabled` (verified-email link,
      no `trustedProviders`), open signup (no `disableSignUp`/
      `disableImplicitLinking`), and session durations from config — are
      unit-tested in `_lib/auth.test.ts` (`authOptions`); the runtime OAuth
      mechanics are better-auth's own tested defaults. (A full stubbed-Google
      callback test needs a Kysely-PGlite dialect for better-auth and is not
      stood up here; the config contract + manual preview cover it.)
- [x] Zero-methods deployment: with no `GOOGLE_CLIENT_*`, the sign-in page
      states no method is configured and the app builds/runs (tested:
      `configuredAuthMethods` → `[]`; build succeeds without any secret).
- [x] Dashboard requires a session (`getSession` → redirect to `/sign-in`);
      `/api/ingest` unchanged — still CRON_SECRET, never session-gated.
- [x] Seam lint: better-auth's pg pool + adapter are confined to
      `apps/web/src/app/_lib`; no `packages/` module imports better-auth or
      the auth module — the storage port is untouched by auth (grep- and
      depcruise-verified).
