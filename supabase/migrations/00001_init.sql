-- Postgres schema (ADR-0011) — the Supabase twin of the SQLite DDL in
-- packages/core/src/storage/schema.ts. Same tables, same constraints; the
-- repository contract tests run against both engines. Per MVP.md §4,
-- deliberately tightened:
--
-- - NOT NULL on every observation/PK column. Postgres PK columns are
--   implicitly NOT NULL; kept explicit to mirror the SQLite DDL, where the
--   tightening is load-bearing (non-STRICT SQLite permits NULL PK parts).
-- - CHECK codifying §4's instrument state enum.
-- - prices.close CHECK (close > 0): partial backstop for the DailyClose
--   contract. Postgres double precision CAN store 'Infinity' (and
--   'Infinity' > 0 is true), so this CHECK cannot express finiteness — the
--   repository-level Number.isFinite validation stays the primary gate;
--   adapters remain the primary fail-loud edge (CLAUDE.md guardrail 6).
-- - Dates are text, not date: the port trades zero-padded ISO strings
--   (IsoDate) whose as-of bounds compare lexicographically, identically in
--   both engines; validity is enforced by assertIsoDate at the write edge.
-- - analyst_snapshots columns NOT NULL, matching the non-nullable
--   AnalystSnapshot type. If backlog 010's open question makes targets
--   nullable, type and both schemas migrate together.
--
-- Observations (prices, snapshots) are append-only: the repository exposes
-- no UPDATE or DELETE for them (CONSTITUTION.md §3.1). instruments is the
-- one mutable table — it holds ingestion bookkeeping, not observations.

CREATE TABLE IF NOT EXISTS instruments (
  ticker text PRIMARY KEY,
  currency text,
  state text NOT NULL CHECK (state IN ('pending', 'backfilling', 'ready', 'error')),
  added_at text NOT NULL,
  last_price_sync text,
  last_metadata_sync text,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0)
);

CREATE TABLE IF NOT EXISTS prices (
  ticker text NOT NULL,
  date text NOT NULL,
  close double precision NOT NULL CHECK (close > 0),
  PRIMARY KEY (ticker, date)
);

CREATE TABLE IF NOT EXISTS analyst_snapshots (
  ticker text NOT NULL,
  as_of text NOT NULL,
  median_target double precision NOT NULL,
  num_analysts integer NOT NULL,
  PRIMARY KEY (ticker, as_of)
);

CREATE TABLE IF NOT EXISTS earnings_snapshots (
  ticker text NOT NULL,
  as_of text NOT NULL,
  next_earnings_date text,
  PRIMARY KEY (ticker, as_of)
);

CREATE TABLE IF NOT EXISTS dividend_snapshots (
  ticker text NOT NULL,
  as_of text NOT NULL,
  next_ex_div_date text,
  PRIMARY KEY (ticker, as_of)
);
