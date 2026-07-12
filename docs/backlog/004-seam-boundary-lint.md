# 004 — Dependency-boundary lint rule

**Milestone:** M0 · **Depends on:** 001 · **Spec:** `CONSTITUTION.md` §2.2–2.3, `CLAUDE.md` guardrail 1

## Goal

Make the seam boundaries mechanical: an import that crosses a seam fails CI, so source agnosticism cannot rot silently.

## Scope

- A dependency-boundary rule (`eslint-plugin-import` or `dependency-cruiser`) enforcing:
  - `metrics/` and `screens/` import from `storage/` (and shared types/config) **only** — never from `providers/`.
  - Only `providers/<name>/` may import `yahoo-finance2` or reference any Yahoo-specific identifier.
  - `screens/` performs no I/O imports; `ui/` imports no business logic beyond screens/metrics output types.
- Wired into CI so a violation fails the build.

## Acceptance criteria

- [ ] An intentional cross-seam import (e.g. `metrics/` importing from `providers/`) fails lint — demonstrated, then removed.
- [ ] `npm test` / CI includes the lint check.
- [ ] Completing 001–004 satisfies the M0 Definition of Done.
