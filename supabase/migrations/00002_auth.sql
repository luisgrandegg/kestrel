-- better-auth tables (backlog item 020, ADR-0013).
--
-- These four tables are better-auth's OWN schema — user identity and
-- sessions — living BESIDE the market-data schema in 00001_init.sql, not
-- behind the StorageRepository port. better-auth reaches them through its
-- own (Kysely) Postgres adapter (a documented seam exception, ADR-0013).
--
-- The DDL below is transcribed from better-auth 1.6's migration generator
-- (@better-auth/core get-tables + better-auth get-migration) for the
-- Postgres dialect with default string IDs:
--   string  -> text        boolean -> boolean      date -> timestamptz
--   id / FK -> text        required -> NOT NULL     unique -> UNIQUE
--   date fields whose default is a function (createdAt/updatedAt) get a
--   DEFAULT CURRENT_TIMESTAMP; expiresAt has no default.
-- Identifiers are quoted camelCase (and "user" is quoted — it is reserved)
-- exactly as better-auth's generated SQL expects; do not fold to snake_case
-- without matching field overrides in _lib/auth.ts.
--
-- If auth config later adds plugins or additionalFields, regenerate with
-- `npx @better-auth/cli generate` and add a new migration — never edit this
-- one (append-only migrations).

create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null,
  "image" text,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null default current_timestamp
);

create table "session" (
  "id" text not null primary key,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null default current_timestamp,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

create table "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null default current_timestamp
);

create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null default current_timestamp
);
