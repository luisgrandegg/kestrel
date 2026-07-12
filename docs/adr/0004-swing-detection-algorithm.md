# ADR-0004: Swing detection — closes-only, single-threshold zigzag, confirm-on-reversal

**Status:** Accepted — 2026-07-12

## Context
ADR-0003 requires counting directional swings ≥ a threshold. The exact algorithm must be pinned, because naive implementations disagree on three points: what counts as a single "peak," how small noise *within* a leg is handled, and how the still-unfolding final leg is treated.

## Decision
- **Closes only.** Ignore intraday. Simpler, and it removes any OHLC requirement — widening which providers can serve Category 1.
- **Percentage zigzag / directional-change** with a **single threshold θ** (default 10%). The same θ defines both a countable leg and the reversal that ends the prior leg.
- **Confirm-on-reversal.** A leg is counted only once price reverses ≥ θ from that leg's extreme. The trailing, un-reversed leg is **never** counted — even if it has already moved past θ.
- **Symmetric.** Up-legs and down-legs count equally.

Behaviour is pinned by the acceptance tests in `mvp.md` §5.2 (e.g. `[100,112,98,113,99,114] → 4`, with the final +15% leg excluded).

## Consequences
- Unambiguous and testable; sub-θ noise inside a leg neither splits nor double-counts it.
- Closes-only keeps the provider pool wide.
- **Deliberate off-by-one:** the final in-progress swing isn't counted until confirmed, and a purely monotonic run counts as **0**. Accepted — "is it swinging *right now*" is the dislocation signal deferred to v2. This refined an earlier informal example that had counted a trailing un-reversed leg.

## Alternatives considered
- **Intraday-range or peak-to-trough episode detection** — rejected for MVP: needs OHLC and is more complex; closes are accurate enough.
- **Count-on-attainment** (count a leg the instant it crosses θ, before any reversal) — rejected: would count trailing legs that may still be extending; the user chose completed-only.
- **Dual threshold** (separate minimum-leg-size vs reversal-sensitivity) — deferred to v2: one knob is simpler and sufficient.
