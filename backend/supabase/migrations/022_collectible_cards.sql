-- CAP Companion App — migration 022: Collectible Cards (Cobb Coins spend side)
--
-- Adds the first spend/redemption mechanic on top of Cobb Coins: guests pay
-- coins to "collect" a randomized, personalized photo card for one of the
-- park's animals.
--
--   collectible_redemptions: append-only spend ledger, sibling to
--   coin_awards (migration 011) rather than negative rows in it -- that
--   table's `amount > 0` check is what keeps the earn side honest. Each row
--   doubles as both the spend record and a gallery item (animal, tier,
--   which curated photo it rolled, whose name it was collected under) -- see
--   app/services/collectibles.py. app/services/coins.get_total() now nets
--   coin_awards.amount against this table's coins_spent. No FK to an animal
--   table -- same reasoning as coin_awards.source_id in migration 011: the
--   animal roster is a frontend-only constant (frontend/src/animalContent.ts),
--   not a DB table, so animal_slug is a plain text column.
--
--   Reset Session (app/services/session_reset.py) now also clears this
--   table wholesale, same as coin_awards -- collectible cards are tied to
--   the shared kiosk session, not persistent identity; the guest's own
--   downloaded/shared image is the intended "real" persistence.
--
-- The old generic badge system (Bronze/Silver/Gold Explorer/Legend, migration
-- 011's `collectibles` table) is removed entirely -- replaced by this
-- feature, not extended by it. Nothing else references collectibles' rows by
-- id (badges were read by comparing coin_awards' running total against each
-- row's unlock_threshold, never joined), so the drop is safe.
--
-- Per the project's established gotcha (seed.sql/schema.sql edits don't
-- reach the live DB -- see migrations 004-010's headers), this migration is
-- what actually applies the change; schema.sql/seed.sql are updated
-- separately for docs accuracy. service_role privileges on this new table
-- come for free via migration 017's `alter default privileges`.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: table create and drop are both guarded.

create table if not exists collectible_redemptions (
    id           uuid primary key default gen_random_uuid(),
    animal_slug  text not null,
    tier         text not null check (tier in ('standard', 'special')),
    -- 1-based index into the animal's curated photo pool (see
    -- app/services/collectibles.py's PHOTO_POOL_SIZE) -- which photo this
    -- specific purchase randomly rolled.
    photo_index  integer not null check (photo_index > 0),
    guest_name   text not null,
    coins_spent  integer not null check (coins_spent > 0),
    created_at   timestamptz not null default now()
);

create index if not exists collectible_redemptions_created_at_idx on collectible_redemptions(created_at);

drop table if exists collectibles;
