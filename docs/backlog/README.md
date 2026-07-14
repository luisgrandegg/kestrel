# Kestrel MVP Backlog

The MVP (`MVP.md`) cut into dependency-ordered backlog items. Work them **top to bottom** — the order matches the milestone plan in `CLAUDE.md`, which puts the riskiest, most testable logic first.

Each item links back to the sections of `MVP.md` / `CONSTITUTION.md` it implements. Those documents remain the source of truth; if an item here ever contradicts them, the documents win (`CONSTITUTION.md` > `MVP.md`).

## Index

| # | Item | Milestone | Depends on |
|---|------|-----------|------------|
| [001](001-project-scaffold.md) | Project scaffold (TypeScript, test runner) | M0 | — |
| [002](002-config-module.md) | Config module with MVP defaults | M0 | 001 |
| [003](003-shared-types.md) | Shared types and DTOs | M0 | 001 |
| [004](004-seam-boundary-lint.md) | Dependency-boundary lint rule | M0 | 001 |
| [005](005-fluctuation-acceptance-tests.md) | Fluctuation metric acceptance tests (test-first) | M1 | 001, 003 |
| [006](006-completed-fluctuations-metric.md) | `completedFluctuations` metric | M1 | 005 |
| [007](007-implied-upside-metric.md) | `impliedUpside` metric | M1 | 002, 003 |
| [008](008-sqlite-storage-repository.md) | SQLite schema + repository | M2 | 003 |
| [009](009-provider-interface-and-registry.md) | Provider interface + capability registry | M3 | 003 |
| [010](010-yahoo-adapter.md) | Yahoo adapter (`yahoo-finance2`) | M3 | 009 |
| [011](011-watchlist-and-lifecycle.md) | Watchlist + instrument lifecycle | M4 | 008 |
| [012](012-backfill-ingestion.md) | Throttled, resumable backfill | M4 | 010, 011 |
| [013](013-daily-refresh.md) | Daily incremental refresh + metadata TTL | M4 | 012 |
| [014](014-screen-framework-base-predicate.md) | Screen framework + base predicate | M5 | 007, 008, 009 |
| [015](015-screen-category1-volatile-undervalued.md) | Screen 1: volatile + undervalued | M5 | 006, 014 |
| [016](016-screen-category2-pre-earnings.md) | Screen 2: pre-earnings + undervalued | M5 | 014 |
| [017](017-screen-category3-pre-ex-dividend.md) | Screen 3: pre-ex-dividend + undervalued | M5 | 016 |
| [018](018-dashboard.md) | Dashboard presentation | M6 | 015, 016, 017 |
| [019](019-scheduled-github-action.md) | Scheduled ingestion (GitHub Action) | M7 | 013 |
| [020](020-user-model-and-store.md) | User model + store | M8 | storage seam (008 + deploy) |
| [021](021-auth-seam-and-sessions.md) | Auth seam + sessions (method-agnostic) | M8 | 020 |
| [022](022-google-authentication.md) | Google authentication | M8 | 021 |

M8 (users & auth) is an owner-directed post-MVP extension (2026-07-14),
beyond MVP.md scope entirely (auth was never listed, not even in §10's
deferral list — the §10 rule below holds unmodified). Scoped to access
control only: the domain pipeline stays user-independent.

## Working rules (from `CLAUDE.md`)

- One milestone at a time: finish its items, get tests green, confirm the milestone's Definition of Done, commit, then continue.
- Test-first for all metrics — item 005 lands **before** item 006 by design.
- When the spec is ambiguous or an item seems to require crossing a seam, stop and ask rather than guessing.
- Everything in `MVP.md` §10 stays out of scope for every item below.
