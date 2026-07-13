# 014 — Screen framework + base predicate

**Milestone:** M5 · **Depends on:** 007, 008, 009 · **Spec:** `MVP.md` §6, `CONSTITUTION.md` §2.1–2.2

## Goal

The declarative screen shape all three categories share: a predicate over metrics, a `requiredCapabilities` declaration, and the shared base predicate. No I/O in this layer.

## Scope

- Screen interface: `requiredCapabilities: Capability[]` + a predicate evaluated over metric inputs read from storage.
- **Base predicate**, shared by all screens:
  ```
  BASE(ticker) := numAnalysts ≥ minAnalysts AND impliedUpside ≥ upsideThreshold
  ```
  `upsideThreshold` configurable per screen (item 002); `minAnalysts` global.
- Evaluation harness: given the repository and an as-of date, compute metric inputs from stored data and evaluate each enabled screen; consult the registry (item 009) to disable screens with unmet capabilities.
- Screens import from `storage/`, `metrics/`, `config/` only — never `providers/` (lint from item 004 applies).
- **Composition root:** the evaluation harness is the one place that may import both `screens/` and `providers/` (to consult the registry). It cannot live in `screens/` (boundary lint forbids it — verified). Put it in a dedicated directory (e.g. `src/app/`) and **extend `.dependency-cruiser.cjs`** so the seam-direction rules cover that directory too; the `ScreenResolution` type already lives in `types/` so screens/UI can type against it without crossing the seam.
- Each match carries its supporting numbers (upside, target, close, analyst count, etc.) for presentation.

## Acceptance criteria

- [ ] Base predicate unit-tested over fixtures, thresholds from config.
- [ ] Per-screen `upsideThreshold` override proven in a test (e.g. 40% vs default 20%).
- [ ] Disabled-screen path works end-to-end with the registry: unmet capability → screen skipped **with the missing capability reported**, no fabricated results.
- [ ] No I/O and no provider imports in `screens/`.
