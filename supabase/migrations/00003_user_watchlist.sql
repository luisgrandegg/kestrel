-- Per-user watchlists (backlog item 021, ADR-0013).
--
-- Which user tracks which ticker — the Postgres twin of the user_watchlist
-- table in packages/core/src/storage/schema.ts (the repository contract tests
-- run this shape against both engines).
--
-- `user_id` holds better-auth's user id as a plain column: a LOGICAL
-- reference, NOT a foreign key. better-auth's `user` table (00002_auth.sql)
-- lives beside this storage seam and is not part of the SQLite reference
-- engine, so a real cross-schema FK could not pass the two-engine contract.
-- Ownership boundary: auth tables are better-auth's; this table is ours.
--
-- Mutable bookkeeping (like `instruments`), not an append-only observation:
-- removing a ticker DELETEs the membership row, while the ticker's
-- price/snapshot history is retained (append-only, CONSTITUTION.md §3.1).

create table if not exists user_watchlist (
  user_id text not null,
  ticker text not null,
  added_at text not null,
  primary key (user_id, ticker)
);
