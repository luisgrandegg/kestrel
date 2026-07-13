# 009 — Provider interface + capability registry

**Milestone:** M3 · **Depends on:** 003 · **Spec:** `MVP.md` §3, `CONSTITUTION.md` §2.1

## Goal

The core contract: providers advertise capabilities, screens declare required capabilities, the registry resolves between them. Built for N providers even though the MVP ships one.

## Scope

- `Provider` interface per `MVP.md` §3: `id`, `capabilities: ReadonlySet<Capability>`, optional `getCloses` / `getAnalystTargets` / `getNextEarnings` / `getNextExDividend`.
- Registry mapping each capability → ordered list of active providers advertising it.
- Screen-disable resolution: given a screen's `requiredCapabilities`, report whether it can run and, if not, **which capability is missing**. Never silently skip, never fabricate.
- Providers know nothing about screens; screens know nothing about providers.

## Acceptance criteria

- [x] Contract tests with fake providers: capability → provider resolution, ordered lists, one provider serving many capabilities, one capability served by many providers.
- [x] Test: a screen with an unserved capability is reported **disabled with the missing capability named**.
- [x] Test: a screen with all capabilities served resolves and is enabled.
- [x] Registry code contains no provider-specific names.
