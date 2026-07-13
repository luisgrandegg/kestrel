/**
 * SQLite schema (backlog item 008) — per MVP.md §4, deliberately tightened:
 *
 * - NOT NULL on every observation/PK column: SQLite permits NULL in
 *   non-STRICT composite PRIMARY KEY columns, and NULL keys are pairwise
 *   distinct — which would defeat insert-or-ignore idempotency.
 * - CHECK codifying §4's instrument state enum.
 * - `prices.close CHECK (close > 0)`: partial backstop for the DailyClose
 *   contract. SQL cannot express finiteness (Infinity > 0 is true), so the
 *   repository validates Number.isFinite before insert; adapters remain the
 *   primary fail-loud gate (CLAUDE.md guardrail 6).
 * - `analyst_snapshots` columns NOT NULL, matching the non-nullable
 *   AnalystSnapshot type. If backlog 010's open question makes targets
 *   nullable, type and schema migrate together.
 *
 * Observations (prices, snapshots) are append-only: the repository exposes
 * no UPDATE or DELETE for them (CONSTITUTION.md §3.1). `instruments` is the
 * one mutable table — it holds ingestion bookkeeping, not observations.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS instruments (
  ticker TEXT PRIMARY KEY,
  currency TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'backfilling', 'ready', 'error')),
  added_at TEXT NOT NULL,
  last_price_sync TEXT,
  last_metadata_sync TEXT
);

CREATE TABLE IF NOT EXISTS prices (
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  close REAL NOT NULL CHECK (close > 0),
  PRIMARY KEY (ticker, date)
);

CREATE TABLE IF NOT EXISTS analyst_snapshots (
  ticker TEXT NOT NULL,
  as_of TEXT NOT NULL,
  median_target REAL NOT NULL,
  num_analysts INTEGER NOT NULL,
  PRIMARY KEY (ticker, as_of)
);

CREATE TABLE IF NOT EXISTS earnings_snapshots (
  ticker TEXT NOT NULL,
  as_of TEXT NOT NULL,
  next_earnings_date TEXT,
  PRIMARY KEY (ticker, as_of)
);

CREATE TABLE IF NOT EXISTS dividend_snapshots (
  ticker TEXT NOT NULL,
  as_of TEXT NOT NULL,
  next_ex_div_date TEXT,
  PRIMARY KEY (ticker, as_of)
);
`;
