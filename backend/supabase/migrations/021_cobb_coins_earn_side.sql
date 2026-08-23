-- CAP Companion App — migration 021: Cobb Coins earn-side rework
--
-- Bingo's flat 2-coins-per-tile award (source_type 'bingo_tile') is removed
-- entirely -- Bingo coins now come only from milestone tiers (10/25/50,
-- awarded in app/services/map_bingo.py's complete_tile() off the same
-- display_hit that already drives the milestone banner, so the coin tier
-- and the displayed banner can never disagree). Two new one-time bonuses are
-- added: 'hunt_complete' (+25 when the last of the 5 Scavenger Hunt
-- characters is found, on top of the existing per-character award) and
-- 'map_exploration' (+50 once, when every currently-open top-level map node
-- has been visited). Both bonuses are guarded against double-award by
-- checking whether a coin_awards row of that source_type already exists --
-- no new tracking column needed, since Reset Session (app/services/
-- session_reset.py) now also clears coin_awards entirely, which resets that
-- guard for free.
--
-- The existing CHECK on coin_awards.source_type was left unnamed in
-- migration 011, so Postgres auto-named it coin_awards_source_type_check --
-- verify that name still holds (select conname from pg_constraint where
-- conrelid = 'coin_awards'::regclass) before trusting the "if exists" drop
-- below to actually find it. Same drop/add-constraint pattern as migration
-- 015_turn_based_scoring.sql.
--
-- Per the project's established gotcha (seed.sql/schema.sql edits don't
-- reach the live DB -- see migrations 004-010's headers), this migration is
-- what actually applies the change; schema.sql is updated separately for
-- docs accuracy.
--
-- Any existing 'bingo_tile' rows (the flat per-tile award this migration
-- removes) would violate the new CHECK constraint below, since there's no
-- meaningful mapping from a flat per-tile award onto a milestone tier --
-- they're deleted first. This is safe: coin_awards is disposable event-log
-- data, not a durable record (the whole table is now cleared wholesale by
-- Reset Session too), so a one-time clear of the rows this exact migration
-- obsoletes is the same operation Reset Session already performs routinely.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: idempotent (the delete is a no-op once no
-- 'bingo_tile' rows remain, and the constraint swap always re-applies clean).

delete from coin_awards where source_type = 'bingo_tile';

alter table coin_awards drop constraint if exists coin_awards_source_type_check;
alter table coin_awards add constraint coin_awards_source_type_check
    check (source_type in ('scavenger_hunt', 'puzzle_timer', 'scoring_sheet_win', 'bingo_milestone', 'hunt_complete', 'map_exploration'));
