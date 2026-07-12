# ADR-0001: Documentation structure and use of ADRs

**Status:** Accepted — 2026-07-12

## Context
Kestrel is specified as a handoff to an agentic build (Claude Code). Different kinds of information have different lifespans and audiences: invariants that must never change, the current iteration's concrete target, instructions for how the agent should build, and the history of why decisions were made. Mixing these in one document creates competing tenses and intent. Agents in particular follow their instruction file literally, so embedding "how we got here" alongside "what to do now" risks the agent acting on superseded intent.

## Decision
Four single-purpose artifacts:
- **`constitution.md`** — durable invariants; never-violate rules; stable across versions.
- **`mvp.md`** — the current concrete slice (formulas, defaults, data model, tests); rewritten each iteration.
- **`CLAUDE.md`** — how the agent should build the current target (order, workflow, guardrails).
- **`docs/adr/`** — decision provenance; one append-only record per locked decision.

Authority order for the build: `constitution.md` > `mvp.md` > `CLAUDE.md` > agent judgement. ADRs are **non-authoritative** for the agent; they are background for humans.

## Consequences
- Each document stays tight and present-tense; no doc carries competing purposes.
- Provenance is preserved without polluting the agent's instructions.
- Small ongoing overhead: locking a decision means adding an ADR.

## Alternatives considered
- **Single `DECISIONS.md`** — rejected: grows unbounded and is harder to navigate than numbered files with an index.
- **Rationale/history inside `CLAUDE.md`** — rejected: puts stale intent in the agent's instruction file, the exact failure mode the authority-order rule guards against.
