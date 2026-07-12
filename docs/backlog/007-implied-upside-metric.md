# 007 — `impliedUpside` metric

**Milestone:** M1 · **Depends on:** 002, 003 · **Spec:** `MVP.md` §5.1, `CONSTITUTION.md` §3.2, §5

## Goal

The base-predicate input every screen shares, as a pure, test-covered function.

## Scope

- `impliedUpside = (medianTarget − latestClose) / latestClose`, over values passed in (fixtures in tests; storage reads happen in the screening layer, not here).
- **Quality gate:** instruments with `numAnalysts < minAnalysts` (config, default 5) do not qualify — the metric/gate must make "does not qualify" explicit, never a silent wrong number.
- Explicit handling of numeric edge cases: zero/near-zero `latestClose`, missing `medianTarget` or `numAnalysts` — fail explicitly, no `NaN` propagation.
- Deterministic: any as-of behaviour comes from an explicit parameter, never the wall clock (guardrail 2).

## Acceptance criteria

- [ ] Formula tests over fixtures, written before/with the implementation.
- [ ] `numAnalysts` below the gate → explicit "not qualified" result, tested.
- [ ] Zero/near-zero price and missing-field cases tested and handled loudly.
- [ ] `minAnalysts` read from config, not hardcoded.
- [ ] Completing 005–007 satisfies the M1 Definition of Done.
