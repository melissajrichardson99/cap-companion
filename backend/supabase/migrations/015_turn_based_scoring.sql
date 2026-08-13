-- CAP Companion App — migration 015: turn-based Scoring Sheet
--
-- Scoring Sheet moves from free-for-all button presses to enforced turn
-- order, with a Miss (0-point) action and a round-based data model for the
-- export (Plan.md 2.2 redesign). This migration:
--
--   1. Loosens game_score_events.point_value to allow 0, and seeds a "Miss"
--      event per existing game so Miss reuses the same events/entries
--      machinery as every real scoring action (win engine already handles
--      0-point entries fine -- summing zero changes nothing).
--
--   2. Adds score_entries.turn_round: the 1-indexed turn-cycle round a given
--      entry belongs to, i.e. that PLAYER's Nth turn. This is deliberately
--      NOT the same concept as ScoreSheetSession.round_number /
--      WinCheckResult.round_number in app/services/scoring.py, which only
--      exists for Tiki Toss's throws_per_round win-check boundary (every 10
--      throws). turn_round is per-player-per-turn and applies to every game;
--      the Tiki-Toss-specific round_number is unrelated and unchanged.
--      Backfilled via row_number() over (session_id, player_name) ordered by
--      created_at, so historical free-for-all sessions (recorded before this
--      migration, with no real turn order) still get a sensible sequential
--      value per player -- nothing is lost or needs manual cleanup.
--
-- Per the project's established gotcha (seed.sql edits don't reach the live
-- DB -- see migrations 004/005/006/007's headers), this migration is what
-- actually applies the change to the live database; seed.sql and schema.sql
-- are updated separately (seed.sql for fresh-install data, schema.sql for a
-- fresh project's baseline).
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: the constraint is dropped/recreated
-- unconditionally (cheap, no data implications), the Miss inserts are
-- guarded by ON CONFLICT DO NOTHING on (game_id, label), the column add is
-- guarded by IF NOT EXISTS, and the backfill only touches rows where
-- turn_round is still null.

-- ---------------------------------------------------------------------------
-- 1. allow 0-point score events (Miss)
-- ---------------------------------------------------------------------------
alter table game_score_events drop constraint if exists game_score_events_point_value_check;
alter table game_score_events add constraint game_score_events_point_value_check check (point_value >= 0);

insert into game_score_events (game_id, label, point_value, sort_order)
select g.id, 'Miss', 0, 99
from scoring_games g
where g.name in ('Farm Toss', 'Horse Hoops', 'Cornhole', 'Cornhole Extreme', 'Tiki Toss / Ring & Hook')
on conflict (game_id, label) do nothing;

-- ---------------------------------------------------------------------------
-- 2. score_entries.turn_round
-- ---------------------------------------------------------------------------
alter table score_entries add column if not exists turn_round integer;

update score_entries se
set turn_round = sub.rn
from (
    select id, row_number() over (partition by session_id, player_name order by created_at) as rn
    from score_entries
) sub
where se.id = sub.id
  and se.turn_round is null;

alter table score_entries alter column turn_round set not null;
