-- CAP Companion App — migration 024: Per-Device Sessions Phase 1
-- (Cobb Coins + Collectible Cards)
--
-- Scopes the Cobb Coins earn ledger (coin_awards) and the Collectible Cards
-- spend ledger (collectible_redemptions) to device_sessions (migration 023).
-- The two move together in one migration, not separately: coins.get_total()
-- nets sum(coin_awards.amount) - sum(collectible_redemptions.coins_spent),
-- so scoping only one table would let one guest's purchases silently
-- corrupt another guest's balance (see app/services/coins.py).
--
-- Clean cutover, not a backfill: this is a POC with no real guest data worth
-- preserving (current live rows are just staff test data), so both tables
-- are wiped before the column is added -- there's no "legacy session" to
-- backfill old rows onto. This must happen before the ADD COLUMN below,
-- since a NOT NULL column with no default cannot be added to a non-empty
-- table.
--
-- No grant/alter-default-privileges block needed: this is an ALTER TABLE
-- ADD COLUMN on tables already granted service_role privileges (coin_awards
-- via migration 011/017, collectible_redemptions via migration 022) --
-- grants are table-level, not column-level, same reasoning as migration
-- 019's map_nodes.is_open column. Verify with a live round-trip anyway per
-- this project's standing "queries silently return empty/stale, no error"
-- gotcha -- don't take it on faith.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: the deletes are idempotent (no-op once
-- empty) and the column adds are guarded.

delete from coin_awards;
delete from collectible_redemptions;

alter table coin_awards
    add column if not exists session_id uuid not null references device_sessions(id);

alter table collectible_redemptions
    add column if not exists session_id uuid not null references device_sessions(id);
