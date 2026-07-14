# 020 — User model + store

**Milestone:** M8 (users & auth — owner-directed post-MVP extension, 2026-07-14) · **Depends on:** items 008/deploy PR 3 (storage seam, both engines) · **Spec:** this item (no MVP.md section; auth/users were never in MVP scope — not even in §10's deferral list)

## Goal

A minimal user model behind the storage seam so the web app can know who is
signed in — designed so the *authentication method* is invisible at this
layer (item 021 owns the flow, item 022 the first concrete method).

## Scope

- **Two tables**, mutable bookkeeping like `instruments` (users are not
  observations; the append-only rule does not apply to them):
  - `users`: `id` (generated), `email` (unique, normalized lowercase),
    `display_name`, `created_at`, `last_login_at`.
  - `user_identities`: `(provider, subject)` unique pair → `user_id`.
    One row per external identity; a user may hold several (Google today,
    anything else later) — this is what makes the model method-agnostic.
- **`UserStore` port** in `packages/core/src/storage/` (same pattern as
  `StorageRepository`: async interface, driverless): `findByIdentity`,
  `findByEmail`, `createWithIdentity`, `addIdentity`, `recordLogin`,
  `getUser`. Fail-loud validation at the write edge (email shape,
  non-empty provider/subject) in the shared validation module.
- Implementations for **both engines** (SQLite `schema.ts` twin +
  `supabase/migrations/00002_users.sql`), covered by ONE contract suite
  run against both — exactly like `describeRepositoryContract`.
- Seam lint: the port/engine rules (`port-not-driver`,
  `only-storage-touches-the-database`) must cover the new modules; extend
  patterns if the file layout requires it, probe-verify.
- **Not in scope:** per-user watchlists or per-user config — the domain
  pipeline stays user-independent; users only gate *access* (item 021).

## Open questions — decide before building

1. **User provisioning:** create a user automatically on first successful
   sign-in (recommended: with an allowlist gate, see item 022), or
   require pre-registration by the owner?
2. **Email as the linking key:** when a new identity's verified email
   matches an existing user, link it to that user automatically
   (recommended — enables adding a second method later without manual
   linking; ONLY over provider-verified emails), or always create a
   distinct user?

## Acceptance criteria

- [ ] Contract suite green against SQLite and PGlite-backed Postgres.
- [ ] `(provider, subject)` uniqueness and email uniqueness enforced at
      the schema level; duplicate inserts fail loud (no silent upsert).
- [ ] No module outside `storage/` and the composition roots imports an
      engine module (probe-verified).
- [ ] The domain pipeline (ingest, metrics, screens) compiles untouched —
      users introduce no edge into it.
