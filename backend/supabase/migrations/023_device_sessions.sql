-- CAP Companion App — migration 023: Per-Device Sessions Phase 0
--
-- Foundational plumbing only -- this table backs a throwaway verification
-- endpoint (GET /session/whoami, app/routers/device_session.py) and the
-- reusable get_or_create_session dependency (app/device_session.py). No
-- existing feature (Bingo, Coins, Hunt, Collectibles, Passport, Puzzle
-- Timer, map nodes, Favorite Photo) reads or writes this table yet --
-- that's later phases, one feature at a time.
--
-- device_token is generated client-side via crypto.randomUUID() and sent as
-- the X-Device-Session header; the backend never issues tokens, it just
-- upsert-on-first-use's whatever token it's handed (see
-- app/device_session.py's use of .upsert(..., on_conflict="device_token")).
-- No expiry column -- sessions live indefinitely from the guest's
-- perspective; a future phase adds separate backend housekeeping to prune
-- long-inactive rows.
--
-- Per the project's established gotcha (seed.sql/schema.sql edits don't
-- reach the live DB -- see migrations 004-010's headers), this migration is
-- what actually applies the change; schema.sql is updated separately for
-- docs accuracy.
--
-- This is a new table, not an ALTER on an existing one, so -- unlike
-- migration 022's collectible_redemptions -- don't assume migration 017's
-- `alter default privileges` already covers it; that clause only grants
-- service_role privileges on tables created afterward *by the same role
-- that ran the ALTER DEFAULT PRIVILEGES statement*. Granting explicitly
-- below and verifying with a live round-trip rather than assuming.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: table create is guarded and the grant is
-- idempotent.

create table if not exists device_sessions (
    id              uuid primary key default gen_random_uuid(),
    device_token    text not null unique,
    created_at      timestamptz not null default now(),
    last_active_at  timestamptz not null default now()
);

grant all privileges on table device_sessions to service_role;
