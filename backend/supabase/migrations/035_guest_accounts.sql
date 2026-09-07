-- CAP Companion App — migration 035: Guest Accounts Phase 0
--
-- Foundational plumbing only -- these tables back the throwaway verification
-- endpoint (GET /account/whoami, app/routers/account.py) and the signup/
-- login/logout/password-reset endpoints in that same router. No existing
-- feature (Bingo, Coins, Hunt, Collectibles, Passport, Puzzle Timer, map
-- nodes, Favorite Photo, device_sessions) reads or writes these tables --
-- that's later phases, one feature at a time, same staged approach as the
-- Per-Device Sessions migration (see 023_device_sessions.sql).
--
-- Entirely additive: device_sessions (anonymous per-device tokens) keeps
-- working completely unchanged whether or not a guest also has an account.
--
-- email is normalized (trimmed + lowercased) by the service layer
-- (app/services/guest_accounts.py's normalize_email) before every insert and
-- lookup, so a plain unique constraint on the column is sufficient -- no
-- citext/expression-index needed as long as nothing else writes this table.
--
-- guest_auth_tokens uses a sliding 90-day expiration: last_active_at is
-- refreshed on every authenticated request (app/guest_auth.py's
-- get_current_guest) and a token is treated as invalid once unused for 90+
-- days (checked in-app, not by a DB job -- no cron/pg_cron in this stack).
--
-- password_reset_tokens is short-lived (1 hour, app/guest_auth.py's
-- RESET_TOKEN_TTL_HOURS) and single-use (used_at set once consumed, checked
-- in app/services/guest_accounts.py's confirm_password_reset).
--
-- Per the project's established gotcha (seed.sql/schema.sql edits don't
-- reach the live DB), this migration is what actually applies the change;
-- schema.sql is updated separately for docs accuracy.
--
-- These are new tables, not ALTERs on existing ones, so -- per migration
-- 023's header -- don't assume migration 017's `alter default privileges`
-- already covers them; granting explicitly below and verifying with a live
-- round-trip rather than assuming.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: table creates are guarded and the grants are
-- idempotent.

create table if not exists guests (
    id              uuid primary key default gen_random_uuid(),
    email           text not null unique,
    password_hash   text not null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table if not exists guest_auth_tokens (
    id              uuid primary key default gen_random_uuid(),
    guest_id        uuid not null references guests(id) on delete cascade,
    token           text not null unique,
    created_at      timestamptz not null default now(),
    last_active_at  timestamptz not null default now()
);

create table if not exists password_reset_tokens (
    id              uuid primary key default gen_random_uuid(),
    guest_id        uuid not null references guests(id) on delete cascade,
    token           text not null unique,
    created_at      timestamptz not null default now(),
    expires_at      timestamptz not null,
    used_at         timestamptz
);

grant all privileges on table guests to service_role;
grant all privileges on table guest_auth_tokens to service_role;
grant all privileges on table password_reset_tokens to service_role;
