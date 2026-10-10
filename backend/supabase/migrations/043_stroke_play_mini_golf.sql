-- CAP Companion App — migration 043: stroke-play Scoring Sheet (Blacklight
-- Mini Golf, Cornhole Mini Golf)
--
-- Mini golf is scored differently from the 5 turn-based games: a fixed
-- number of holes, 1-999 strokes per hole, no par, lowest total wins. It is
-- added as a second scoring mode alongside the turn-based one, not bent to
-- fit it. This migration:
--
--   1. Map: the two courses are in different places, so each gets its own
--      top-level pin (confirmed by Melissa on 2026-10-10):
--      - the existing "Mini-Golf" pin (beside Archery) is renamed to
--        "Blacklight Mini Golf". Same id, same position, so its node_visits
--        and its Bingo tile link carry over untouched.
--      - a new top-level "Cornhole Mini Golf" pin near the animals at
--        (76, 70). PROVISIONAL position -- move it later with:
--          update map_nodes set x_pct = 76.0, y_pct = 70.0 where name = 'Cornhole Mini Golf';
--      Adding a top-level open node raises the Map Exploration bonus
--      threshold from 35 to 36 nodes (accepted). Sessions already awarded
--      the bonus keep it (one-time, guarded by coin_awards).
--
--   2. Bingo: the tile linked to that pin is relabelled to name the course
--      ("Sink a hole-in-one at Blacklight Mini Golf"). The link itself is by
--      id, so it needs no change.
--
--   3. scoring_games gains scoring_mode ('turn_based' | 'stroke_play';
--      existing rows default to turn_based) and a nullable hole_count. Hole
--      count is data, not code: the courses are really 9-12 holes and start
--      at 9. win_condition_type / win_threshold become nullable (stroke play
--      has neither), with a shape check so turn-based rows still must have
--      them and stroke-play rows must have a hole_count.
--
--   4. stroke_play_scores: one row per (session, player, hole). Unique on
--      that triple so correcting a score is an upsert. Hangs off
--      score_sheet_sessions (on delete cascade), so Reset Session, session
--      cleanup, analytics and Passport all cover stroke-play rounds without
--      changes -- same transitive device scoping as score_entries.
--      strokes is checked 1-999 here as well as in the API.
--
--   5. Seeds the two courses: stroke_play, 9 holes, map-node references.
--
-- Run this in the Supabase SQL editor against the live project (seed.sql /
-- schema.sql edits alone never reach the live DB). Safe to run more than
-- once: every DDL statement is guarded, the rename only matches the old
-- name, the node insert and game inserts are ON CONFLICT DO NOTHING, and the
-- map-node seed only fills rows that are still null.
--
-- New table, so the grant is explicit (migration 017's default privileges
-- only cover tables created by the role that ran it -- see 023's header).

-- ---------------------------------------------------------------------------
-- 1. Map nodes
-- ---------------------------------------------------------------------------
update map_nodes
set name = 'Blacklight Mini Golf', description = 'Blacklight mini golf course.'
where name = 'Mini-Golf';

insert into map_nodes (name, category, description, x_pct, y_pct)
values ('Cornhole Mini Golf', 'attraction', 'Cornhole-themed mini golf course.', 76.0, 70.0)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Bingo tile label
-- ---------------------------------------------------------------------------
update bingo_tiles
set label = 'Sink a hole-in-one at Blacklight Mini Golf'
where label = 'Sink a hole-in-one at Mini-Golf';

-- ---------------------------------------------------------------------------
-- 3. scoring_games: mode + hole count
-- ---------------------------------------------------------------------------
alter table scoring_games add column if not exists scoring_mode text not null default 'turn_based';
alter table scoring_games add column if not exists hole_count integer;

alter table scoring_games alter column win_condition_type drop not null;
alter table scoring_games alter column win_threshold drop not null;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'scoring_games_scoring_mode_check') then
        alter table scoring_games add constraint scoring_games_scoring_mode_check
            check (scoring_mode in ('turn_based', 'stroke_play'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'scoring_games_hole_count_check') then
        alter table scoring_games add constraint scoring_games_hole_count_check
            check (hole_count is null or hole_count between 1 and 36);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'scoring_games_mode_shape') then
        alter table scoring_games add constraint scoring_games_mode_shape check (
            (scoring_mode = 'turn_based' and win_condition_type is not null and win_threshold is not null)
            or (scoring_mode = 'stroke_play' and hole_count is not null)
        );
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. stroke_play_scores
-- ---------------------------------------------------------------------------
create table if not exists stroke_play_scores (
    id           uuid primary key default gen_random_uuid(),
    session_id   uuid not null references score_sheet_sessions(id) on delete cascade,
    player_name  text not null,
    hole_number  integer not null check (hole_number >= 1),
    strokes      integer not null check (strokes between 1 and 999),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (session_id, player_name, hole_number)
);

create index if not exists stroke_play_scores_session_id_idx on stroke_play_scores(session_id);

grant all privileges on table stroke_play_scores to service_role;

-- ---------------------------------------------------------------------------
-- 5. Seed the two courses
-- ---------------------------------------------------------------------------
insert into scoring_games (name, slug, rules_text, win_condition_text, scoring_mode, hole_count) values
    (
        'Blacklight Mini Golf',
        'blacklight-mini-golf',
        'Stroke play under blacklight. Count every stroke on every hole.',
        'Lowest total strokes wins. Ties are shared.',
        'stroke_play',
        9
    ),
    (
        'Cornhole Mini Golf',
        'cornhole-mini-golf',
        'Stroke play on the Cornhole Mini Golf course. Count every stroke on every hole.',
        'Lowest total strokes wins. Ties are shared.',
        'stroke_play',
        9
    )
on conflict (name) do nothing;

update scoring_games g
set map_node_id = n.id
from (values
    ('Blacklight Mini Golf', 'Blacklight Mini Golf'),
    ('Cornhole Mini Golf', 'Cornhole Mini Golf')
) as v(game_name, node_name)
join map_nodes n on n.name = v.node_name
where g.name = v.game_name and g.map_node_id is null;
