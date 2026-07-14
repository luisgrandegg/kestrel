# ADR-0013: Users, auth (better-auth), and the multi-user pivot

**Status:** Accepted — 2026-07-14

## Context

The owner directed a post-MVP extension: real users, an authentication flow
that is agnostic of method, and Google sign-in — recorded first as backlog
items 020–022 (a hand-rolled OIDC seam). In deciding those items' open
questions the owner made choices that reshape the deployment, so this ADR
supersedes the hand-rolled plan and records the direction.

## Decisions (2026-07-14)

1. **Auth library: better-auth**, not a hand-rolled OIDC seam. It is
   purpose-built for adding providers later (Google now, others as plugin
   additions) and owns sessions, CSRF, PKCE, and the callback flow. It
   BECOMES the method-agnostic seam that item 021 sketched.
2. **better-auth owns its own tables** (`user`, `session`, `account`,
   `verification`) and reaches Postgres through its own adapter. That sits
   BESIDE our storage seam, not behind it — a documented exception to
   `only-storage-touches-the-database`, precedented by the composition-root
   `pg.Pool` adapter (ADR-0011). Auth identity/sessions are better-auth's
   domain; our market/watchlist data stays behind the `StorageRepository`
   port.
3. **Provisioning:** auto-create a user on first successful sign-in.
   **Identity linking:** a new identity whose provider-VERIFIED email
   matches an existing user links to that user.
4. **Open signup, no allowlist.** With per-user data (below) a stranger
   only ever sees their own empty dashboard, so an allowlist is not needed
   now. (Cost/abuse bounding is deferred, noted as future work.)
5. **Multi-user over shared market data.** Market observations (prices,
   analyst/earnings/dividend snapshots) are shared and ingested ONCE per
   ticker. What is per-user is the **watchlist** (`user_watchlist`, behind
   our port) and therefore the screen results. **Config/thresholds stay
   GLOBAL.**
6. **Union ingestion.** The scheduled run ingests the UNION of all users'
   watchlist tickers (deduped, each fetched once); an instrument lives as
   long as ≥1 user tracks it. `watchlist.json` is retired as the source.
7. **Retire the CLI and the GitHub Action.** `apps/cli` and
   `.github/workflows/ingest.yml` are removed; Vercel + Supabase is the
   sole deployment. The SQLite `Repository` remains ONLY as the fast
   reference engine in the storage contract tests (proving the port), not
   as a deployment target.

## Consequences

- Items 020–022 are re-cut around this (020 = better-auth + private
  dashboard; 021 = per-user watchlists + union ingestion + watchlist UI;
  022 = retire the CLI/Action). Session defaults: 720h absolute / 168h
  sliding, as config keys (guardrail 5).
- One app remains (`apps/web`), so the two-composition-root duplication
  (twinned harness/formatters) collapses to a single home.
- Ingestion's watchlist source moves from a bundled file to a DB query
  over all users; the daily-refresh/backfill lifecycle is otherwise
  unchanged (still throttled, idempotent, resumable).
- A ticker only leaves the system when the last user tracking it drops it;
  its historical observations are retained (append-only, CONSTITUTION §3.1).
- Deferred: per-user config, and any signup cost/abuse bounding.
