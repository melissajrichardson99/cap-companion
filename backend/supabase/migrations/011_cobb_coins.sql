-- CAP Companion App — migration 011: Cobb Coins (POC scope)
--
-- A lightweight collectible/reward layer, no redemption logic in this POC:
--
--   coin_awards: append-only ledger, not a mutable balance column -- the
--   running total is always derived by summing this table (same
--   "derive, don't duplicate" discipline as MapNode.linked_bingo_tile_ids
--   in models.py -- a stored balance column would just be a second source
--   of truth that could drift). source_type tags which feature triggered
--   the award; source_id is the id of the row that triggered it
--   (hunt_characters.id, puzzle_attempts.id, score_sheet_sessions.id, or
--   bingo_tiles.id depending on source_type) -- a polymorphic reference
--   across 4 tables, so it's a plain uuid column rather than an FK (same
--   tradeoff as scannable_codes' typed pair, minus the exactly-one-of
--   constraint since the type tag alone already disambiguates the table).
--
--   collectibles: fixture content -- badges that unlock once a guest's
--   running coin total crosses unlock_threshold. "Unlocked" is computed at
--   read time (total >= threshold), not stored, so it can never drift out
--   of sync with the ledger.
--
-- Award trigger points (app/services/*.py):
--   - bingo_tile: map_bingo.complete_tile(), inside the existing
--     "already completed?" guard -- same idempotent trigger point Bingo
--     milestones/minigame draws already use, not a second implementation.
--   - scavenger_hunt: hunt.complete_challenge(), inside the existing
--     "all 3 challenges done, completed_at not yet set" guard.
--   - puzzle_timer: puzzles.record_attempt(), scaled by hints_used (fewer
--     hints -> more coins) -- see coins.puzzle_timer_amount().
--   - scoring_sheet_win: scoring_sheet._session_from_row()'s auto-lock
--     branch and finish_session()'s manual lock -- both are the same
--     one-time "completed_at just got persisted" points the tie-lock
--     gotcha fix already established, so no risk of a double award.
--
-- Per the project's established gotcha (seed.sql edits don't reach the live
-- DB -- see migrations 004-010's headers), this migration is what actually
-- applies the change to the live database; seed.sql/schema.sql are updated
-- separately (seed.sql gets the 4 launch collectibles; coin_awards gets no
-- seed rows, same as staff_requests -- it's runtime guest-generated data).
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: table/index creates are guarded, and the
-- collectibles insert is guarded by ON CONFLICT (name) DO NOTHING.

create table if not exists coin_awards (
    id          uuid primary key default gen_random_uuid(),
    source_type text not null check (source_type in ('scavenger_hunt', 'puzzle_timer', 'scoring_sheet_win', 'bingo_tile')),
    source_id   uuid not null,
    amount      integer not null check (amount > 0),
    created_at  timestamptz not null default now()
);

create index if not exists coin_awards_source_type_idx on coin_awards(source_type);

create table if not exists collectibles (
    id                uuid primary key default gen_random_uuid(),
    name              text not null unique,
    -- Emoji/icon reference, not an uploaded image -- POC scope.
    icon              text not null,
    unlock_threshold  integer not null check (unlock_threshold > 0),
    created_at        timestamptz not null default now()
);

insert into collectibles (name, icon, unlock_threshold) values
    ('Bronze Explorer',   '🥉', 10),
    ('Silver Adventurer', '🥈', 30),
    ('Gold Champion',     '🥇', 60),
    ('Cobb''s Legend',    '🏆', 100)
on conflict (name) do nothing;
