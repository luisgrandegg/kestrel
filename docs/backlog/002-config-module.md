# 002 — Config module with MVP defaults

**Milestone:** M0 · **Depends on:** 001 · **Spec:** `MVP.md` §9, `CONSTITUTION.md` §4

## Goal

A single `config/` module holding every judgement-encoding threshold, with the `MVP.md` §9 defaults, overridable without code changes. This is what makes guardrail 5 ("no hardcoded judgement") enforceable everywhere else.

## Scope

Defaults exactly as pinned in `MVP.md` §9:

| Key | Default | Scope |
|-----|---------|-------|
| `targetStatistic` | `median` | global |
| `minAnalysts` | `5` | global |
| `upsideThreshold` | `0.20` | per screen |
| `fluctuation.swingPct` (θ) | `0.10` | Category 1 |
| `fluctuation.minOccurrences` | `4` | Category 1 |
| `fluctuation.lookbackTradingDays` | `63` | Category 1 |
| `earnings.windowDays` | `14` | Category 2 |
| `exDividend.windowDays` | `14` | Category 3 |
| `backfillLookbackDays` | `365` | ingestion |
| `metadataTtlDays` | `7` | ingestion |
| `interCallDelayMs` | `1500` | ingestion |

- Typed config object; `upsideThreshold` overridable **per screen**.
- An override mechanism (e.g. a config file merged over defaults) — no code edit needed to change a threshold.

## Acceptance criteria

- [ ] All §9 keys exist with exactly the pinned defaults.
- [ ] Tests prove an override replaces a default without touching source.
- [ ] Per-screen `upsideThreshold` override works while other screens keep the default.
