# 019 — Scheduled ingestion (GitHub Action)

**Milestone:** M7 · **Depends on:** 013 · **Spec:** `MVP.md` §7, §11, `CLAUDE.md` M7

## Goal

Wire the daily ingestion pipeline into a scheduled GitHub Action so the watchlist backfills and stays current unattended.

## Scope

- Workflow with a UTC cron **well after US market close**; tolerant of GitHub cron lag (a late run must still work — dedupe by date means a delayed or repeated run adds nothing).
- Runs the throttled daily pipeline (item 013) as a plain Node CLI script.
- Persists results per the storage strategy (`MVP.md` §11 suggests committing the SQLite file alongside the repo; keep it behind the storage seam).
- Weekend/holiday runs are harmless no-ops (dedupe by trading date).
- Document how to add tickers to the watchlist (README or `docs/`).
- The entrypoint passes explicit watchlist/config paths (the module defaults are cwd-relative and assume repo-root invocation).

## Acceptance criteria

- [ ] The Action runs the throttled daily pipeline on schedule and persists results.
- [ ] A manually re-triggered run on the same day changes nothing (idempotency observed end-to-end).
- [ ] Watchlist-addition docs exist and match item 011's mechanism.
- [ ] M7 — and with it the whole-MVP Definition of Done in `CLAUDE.md` — can be checked off.
