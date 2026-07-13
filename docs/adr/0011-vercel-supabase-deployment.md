# ADR-0011: Deploy target — Vercel + Supabase, monorepo with an in-app ingest worker

**Status:** Accepted — 2026-07-13

## Context

The MVP runs as a scheduled GitHub Action committing a SQLite file and a
rendered text dashboard to the repo. The owner asked to prepare a hosted
deployment: a web dashboard on Vercel with Supabase as the database. Three
choices were put to the owner (2026-07-13); this records the answers.

## Decision

1. **Storage: Supabase Postgres behind the existing storage seam**, accessed
   directly via the `pg` driver and the pooled connection string — the
   repository stays plain SQL, mirroring the SQLite implementation. The
   seam contract is the async `StorageRepository` port
   (`src/storage/port.ts`); SQLite remains the engine for tests and local
   runs.
2. **Dashboard: a Next.js app on Vercel** (owner's explicit choice over a
   minimal HTML endpoint), server-rendering the screen results.
3. **Repository shape: a Turborepo-style monorepo** where the ingest worker
   is a **separate package but run by the app itself for now** (owner's
   proposal): a protected route invoked by Vercel Cron runs the daily
   pipeline. Rationale: at current watchlist size a daily run is a handful
   of throttled provider calls (well inside function duration limits with
   `maxDuration` raised), ingestion is already idempotent and resumable so
   a timeout mid-backfill just resumes next fire, and keeping the worker a
   separate package means it can move to a real worker or back to the
   GitHub Action without internal changes when the watchlist grows.

## Consequences

- The storage port is the load-bearing seam: everything except the
  composition root types against `StorageRepository`, never a concrete
  driver (lint-enforced).
- The schema exists twice (SQLite DDL and a Supabase/Postgres migration);
  the repository contract tests must run against both engines.
- Function duration is the scaling ceiling for in-app ingestion; the
  escape hatch is moving `packages/ingest` to a dedicated runner.
