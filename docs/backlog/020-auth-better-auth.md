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
  not offered — the honest-degradation rule, guardrail 4). Zero methods
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

- [ ] Google sign-in works end-to-end on a deployed preview (manual check
      recorded on the PR); `sub` is the stable identity key, never email.
- [ ] Auto-create + email-link behave per ADR-0013 (tested against
      better-auth's flow with stubbed provider responses — no live Google).
- [ ] Zero-methods deployment: dashboard sign-in page states no method is
      configured; the app does not crash.
- [ ] Dashboard requires a session; `/api/ingest` unchanged (CRON_SECRET).
- [ ] Seam lint: better-auth's DB adapter is confined to the composition
      root (apps/web/src/app); the storage port is untouched by auth.
