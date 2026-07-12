# 005 — Fluctuation metric acceptance tests (test-first)

**Milestone:** M1 · **Depends on:** 001, 003 · **Spec:** `MVP.md` §5.2, `CONSTITUTION.md` §5, `CLAUDE.md` M1

## Goal

Pin the highest-risk logic in the system before implementing it. The `MVP.md` §5.2 acceptance table lands as failing tests **first**; item 006 makes them pass. This ordering is mandated by `CLAUDE.md` ("test-first for all metrics") and `CONSTITUTION.md` §5 ("may not ship without them").

## Scope

Tests against a not-yet-implemented `completedFluctuations(closes, θ)` pure function, with θ = 0.10:

| Input closes | Expected | Why |
|---|---|---|
| `[100,112,98,113,99,114]` | **4** | four confirmed legs; trailing up-leg to 114 excluded |
| `[100,110,121,133]` | **0** | monotonic, never reverses ≥10% |
| `[100,140,138,136]` | **0** | one big up-move, no ≥10% reversal |
| `[100,88,101,89,102,90,103]` | **5** | five confirmed alternating legs; trailing leg excluded |
| `[100,103,97,104]` | **0** | swings under 10% never confirm |

Plus edge cases:

- Fewer than 2 closes → `0`.
- Zero / near-zero prices handled explicitly (no `NaN`/`Infinity` silently produced).
- θ taken as a parameter (fed from config in later items — no magic `0.10` in the metric).

## Acceptance criteria

- [x] All five §5.2 rows encoded as tests, expected values verbatim from the spec.
- [x] The canonical case asserts the trailing **+15%** leg is *not* counted (confirm-on-reversal semantics, `MVP.md` §5.2 "deliberate rule").
- [x] Edge-case tests present.
- [x] Tests fail (red) until item 006 lands — do not stub the metric to green.
