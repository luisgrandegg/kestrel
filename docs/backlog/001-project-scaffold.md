# 001 — Project scaffold (TypeScript, test runner)

**Milestone:** M0 · **Depends on:** — · **Spec:** `MVP.md` §11, `CLAUDE.md` M0

## Goal

A runnable Node + TypeScript repo with a working test runner, so every later item can land test-first.

## Scope

- Node + TypeScript project setup (`package.json`, `tsconfig.json`).
- Test runner installed and wired to `npm test`.
- Module layout skeleton per `MVP.md` §11: `providers/`, `storage/`, `metrics/`, `screens/`, `ingest/`, `ui/`, `config/` (empty or placeholder modules are fine).
- Basic CI workflow that runs `npm test` (the seam lint from item 004 plugs into it).

## Out of scope

- Any domain logic, dependencies on `yahoo-finance2` or SQLite (later items).

## Acceptance criteria

- [ ] `npm test` runs and passes (with at least a trivial placeholder test).
- [ ] TypeScript compiles cleanly.
- [ ] The directory layout matches the five-seam structure of `MVP.md` §11.
