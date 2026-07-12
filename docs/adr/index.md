# Kestrel — Architecture Decision Records

This folder records **why** Kestrel is built the way it is: one record per significant decision, capturing what was chosen, what was rejected, and the reasoning. It is **provenance for humans**, not build instructions — the build is driven by `constitution.md`, `mvp.md`, and `CLAUDE.md`. Nothing here overrides those.

## How we use ADRs

- One decision per file, numbered sequentially: `NNNN-kebab-title.md`.
- ADRs are **append-only**. Once `Accepted`, a record is not edited to reflect a later change of mind. To change a decision, add a **new** ADR that supersedes the old one, and set the old one's status to `Superseded by ADR-XXXX`.
- Status values: `Proposed` · `Accepted` · `Superseded` · `Deprecated`.
- Format is lightweight Nygard-style: Context → Decision → Consequences → Alternatives considered.

## Index

| #  | Decision | Status | Date |
|----|----------|--------|------|
| [0001](0001-documentation-structure.md) | Documentation structure and use of ADRs | Accepted | 2026-07-12 |
| [0002](0002-capability-registry.md) | Capability registry for source-agnostic data | Accepted | 2026-07-12 |
| [0003](0003-volatility-as-swing-frequency.md) | Category-1 volatility measured as completed-swing frequency | Accepted | 2026-07-12 |
| [0004](0004-swing-detection-algorithm.md) | Swing detection: closes-only, single-threshold zigzag, confirm-on-reversal | Accepted | 2026-07-12 |
| [0005](0005-implied-upside-median-target.md) | Implied upside via median analyst target with minimum-analyst gate | Accepted | 2026-07-12 |
| [0006](0006-event-screens-upcoming-only.md) | Event screens are upcoming-only; post-earnings drift deferred | Accepted | 2026-07-12 |
| [0007](0007-append-only-storage.md) | Append-only, as-of-dated storage | Accepted | 2026-07-12 |
| [0008](0008-yahoo-reference-provider.md) | Yahoo (`yahoo-finance2`) as the MVP reference provider | Accepted | 2026-07-12 |
| [0009](0009-throttled-daily-ingestion.md) | Throttled daily batch ingestion with ~1-year backfill | Accepted | 2026-07-12 |
| [0010](0010-project-name-kestrel.md) | Project name: Kestrel | Accepted | 2026-07-12 |
