# Deploying Kestrel (Vercel + Supabase)

The hosted deployment per [ADR-0011](adr/0011-vercel-supabase-deployment.md)
and [ADR-0013](adr/0013-users-auth-and-multi-user.md): the Next.js dashboard
(`apps/web`) on Vercel, reading Supabase Postgres through the storage seam,
with the ingest worker (`packages/ingest`) run by the app itself via a
Vercel-Cron-invoked route (`/api/ingest`). The dashboard is private —
sign-in is via better-auth with Google (item 020).

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the migrations in `supabase/migrations/`, in filename order —
   `00001_init.sql` (market data), `00002_auth.sql` (better-auth's
   `user`/`session`/`account`/`verification` tables, item 020), and
   `00003_user_watchlist.sql` (per-user watchlists, item 021):
   - **SQL editor:** paste each file's contents into the Supabase dashboard's
     SQL editor and run them in filename order; or
   - **supabase CLI:** link the repo (`supabase link --project-ref <ref>`)
     and run `supabase db push` (all migrations live in the conventional
     `supabase/migrations/` directory).
3. Copy the **Transaction pooler** connection string (Project settings →
   Database → Connection string → Transaction pooler, port 6543) and
   append `?sslmode=require` (see §5b — without it node-postgres connects
   unencrypted). This is the `DATABASE_URL` below.

   > **Why the transaction pooler works here:** node-postgres is generally
   > constrained under pgBouncer's transaction mode (no session state, no
   > named prepared statements). Kestrel's repository issues only simple
   > parameterized queries — no named prepared statements, no session
   > settings — and its one multi-statement transaction (`insertCloses`)
   > runs BEGIN…COMMIT on a single checked-out client, which transaction
   > mode supports. If you prefer, the **Session pooler** string also
   > works; the direct (non-pooled) string is not recommended from
   > serverless functions.

## 2. Import the repo into Vercel

1. Vercel → Add New Project → import the GitHub repo.
2. **Root Directory:** `apps/web` — and enable **"Include source files
   outside of the Root Directory"** (the app consumes `@kestrel/core` and
   `@kestrel/ingest` as source).
3. Framework preset: **Next.js** (auto-detected). pnpm is detected from the
   lockfile; no custom build command needed.

Note: `vercel.json` (the cron definition) lives at `apps/web/vercel.json`,
because with a Root Directory set, Vercel reads project config from that
directory, not the repo root.

## 3. Environment variables

Set these on the Vercel project (Production):

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | yes | The Supabase **Transaction pooler** connection string from step 1. Read lazily on first query — `next build` does not need it. Used by both the storage seam and better-auth (each opens its own pool). |
| `CRON_SECRET` | yes | A long random string (e.g. `openssl rand -hex 32`). Vercel Cron automatically sends it as `Authorization: Bearer $CRON_SECRET`; the ingest route rejects everything else (401) and refuses to run at all if unset (500, never an open route). This is machine auth for `/api/ingest` only — it is NOT the user sign-in. |
| `BETTER_AUTH_SECRET` | yes | A long random string (e.g. `openssl rand -base64 32`) — better-auth uses it to sign/encrypt session cookies (item 020). better-auth throws in production if unset, so a deploy without it fails loud on first auth request. |
| `BETTER_AUTH_URL` | yes | The app's public origin, e.g. `https://<your-app>.vercel.app` — better-auth builds OAuth redirect URLs from it. A wrong/missing value causes Google `redirect_uri_mismatch`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Google OAuth credentials (Google Cloud Console → Credentials → OAuth client, type Web application). Authorized redirect URI: `https://<your-app>.vercel.app/api/auth/callback/google`. When BOTH are set, Google sign-in is offered; when absent, the sign-in page honestly says no method is configured (item 020) — the app still builds and runs. |
| `KESTREL_CONFIG` | no | JSON object of config overrides, e.g. `{"minAnalysts": 7, "screens": {"category1": {"upsideThreshold": 0.4}}}`. There is no repo-root cwd on Vercel, so `kestrel.config.json` does not apply to the web app — this env var is the override path. Absent means the MVP.md §9 defaults; invalid JSON or unknown keys fail loud. Session durations (`auth.sessionAbsoluteHours`/`auth.sessionSlidingHours`) are overridable here too. |

## 4. Verify the cron

`apps/web/vercel.json` schedules `GET /api/ingest` at `30 23 * * *` UTC —
well after the US close, tolerant of cron lag because the pipeline dedupes
by UTC date.

- Check Vercel dashboard → project → Settings → Cron Jobs after the first
  production deployment: **crons only run on production deployments**.
- The Hobby plan allows daily crons (with loose firing precision — fine
  here: idempotency makes a late or repeated fire harmless); Pro allows
  more.
- Trigger it manually to smoke-test:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/ingest`
  — the Yahoo adapter (backlog item 010) is registered, so this runs the
  throttled daily refresh + backfill and returns a `report` JSON body; a
  same-day re-fire is a no-op (idempotent, deduped by UTC date).

## 5. Function duration

The route sets `maxDuration = 300`. On projects with **Fluid compute**
(the default for new Vercel projects) that value is allowed on every plan.
On an older project with Fluid disabled, Hobby's ceiling is 60 — and
Vercel then **rejects the deployment** ("maxDuration must be between 1
and 60") rather than clamping at runtime. If you hit that, either enable
Fluid compute for the project or lower `maxDuration` in
`apps/web/src/app/api/ingest/route.ts`.

A runtime timeout mid-run is fine by design: ingestion is idempotent and
resumable (guardrail 7), so a cut-off backfill simply resumes on the next
fire without duplicating anything. If the watchlist outgrows the function
ceiling, the escape hatch recorded in ADR-0011 is to move
`packages/ingest` to a dedicated runner (a real worker) — it is a separate
package precisely so that move touches no internals.

## 5b. TLS to Supabase

`node-postgres` does **not** negotiate TLS unless asked: with a bare
pooler URL the connection is unencrypted. Use the connection string
exactly as Supabase's dashboard shows it and append `?sslmode=require`
(pg understands it in the URL). If Postgres then complains about a
self-signed certificate in the chain, either supply Supabase's CA
(Project settings → Database → SSL) via `sslrootcert`, or fall back to
`?sslmode=no-verify` (encrypted, unverified — still strictly better than
plaintext).

## 5c. Watchlists are per-user, managed in the app

Since item 021 (ADR-0013) the watchlist is per-user, stored in Supabase
behind the storage seam (`user_watchlist`) — there is no bundled
`watchlist.json` and no redeploy needed. A signed-in user adds/removes
tickers on the dashboard; adding one kicks an immediate throttled backfill,
and the daily cron ingests the **union** of every user's tickers (each
fetched once). A ticker nobody tracks is not ingested; its stored history is
retained (append-only).

## 6. Authentication (Google sign-in)

The dashboard is private (item 020, ADR-0013): an unauthenticated request
redirects to `/sign-in`. Sign-in is handled by **better-auth**, mounted at
`/api/auth/*`, with its own `user`/`session`/`account`/`verification` tables
(migration `00002_auth.sql`).

1. In **Google Cloud Console → APIs & Services → Credentials**, create an
   OAuth client (type *Web application*). Add the authorized redirect URI
   `https://<your-app>.vercel.app/api/auth/callback/google` and, for local
   dev, `http://localhost:3000/api/auth/callback/google`.
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, and
   `BETTER_AUTH_URL` (§3). With the Google vars set, the sign-in page offers
   Google; without them it states honestly that no method is configured —
   the app still runs (guardrail-4-style honest degradation).
3. First sign-in **auto-creates** the user; a later Google identity whose
   verified email matches an existing user **links** to it. Signup is open
   (no allowlist) — with per-user data (item 021) a stranger only ever sees
   their own empty dashboard.

`/api/ingest` is unaffected — it stays machine-authenticated with
`CRON_SECRET`, never session-gated.
