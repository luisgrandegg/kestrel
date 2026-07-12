# 018 — Dashboard presentation

**Milestone:** M6 · **Depends on:** 015, 016, 017 · **Spec:** `MVP.md` §8, `CONSTITUTION.md` §1, §2.2

## Goal

Render the screen results grouped by category with the supporting numbers visible, so the user gets research candidates — not bare tickers, and never recommendations.

## Scope

- Dashboard grouped by category, per-row fields exactly per `MVP.md` §8:
  - **Category 1:** ticker, impliedUpside %, medianTarget, latestClose, numAnalysts, completedFluctuations count.
  - **Category 2:** ticker, impliedUpside %, daysToEarnings, next earnings date, numAnalysts.
  - **Category 3:** ticker, impliedUpside %, daysToExDiv, next ex-div date, numAnalysts.
- Disabled screens render a visible **"unavailable — missing capability: X"** state — never hidden, never stale-presented-as-fresh.
- Values in each instrument's **native currency** (no FX normalization — `MVP.md` §10).
- Framing throughout: research candidates, not recommendations; no ranking by conviction, no advice language.
- Presentation contains **no business logic** — it renders what screening produced.

## Acceptance criteria

- [ ] All three categories render with their per-row fields from fixture screen results.
- [ ] A disabled screen shows the missing capability.
- [ ] Mixed currencies display natively, unconverted.
- [ ] No thresholds, predicates, or metric computation in `ui/`.
- [ ] M6 Definition of Done satisfied.
