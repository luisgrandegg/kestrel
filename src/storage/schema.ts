/**
 * SQLite schema (backlog item 008) — exactly per MVP.md §4.
 *
 * Observations (prices, snapshots) are append-only: the repository exposes
 * no UPDATE or DELETE for them (CONSTITUTION.md §3.1). `instruments` is the
 * one mutable table — it holds ingestion bookkeeping, not observations.
 *
 * `prices.close` carries a CHECK enforcing the DailyClose positivity
 * contract in depth: append-only storage means a bad close, once persisted,
 * could never be removed.
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
  median_target REAL,
  num_analysts INTEGER,
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
