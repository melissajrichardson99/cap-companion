-- CAP Companion App — migration 007: Scoring Sheet tables + seed data
--
-- New feature (Plan.md 2.2), so like migration 005 (Puzzle Timer) there's no
-- existing live table to alter — this creates scoring_games /
-- game_score_events / score_sheet_sessions / score_entries from scratch and
-- seeds the 5 documented games (Farm Toss, Horse Hoops, Cornhole, Cornhole
-- Extreme, Tiki Toss/Ring & Hook) with their point tables. Mini Golf and
-- Archery are left out entirely — no confirmed rules yet (Plan.md 2.2/6).
--
-- win_condition_type + win_threshold (+ throws_per_round for round-based
-- games) are machine-readable columns beyond what win_condition_text alone
-- could drive: automatic win detection needs exact threshold/tie-rule math,
-- not text parsing -- same "not just approximate" discipline as the Bingo
-- milestone detector (see app/services/milestone.py and CLAUDE.md's known
-- pitfalls). The three win_condition_type values map 1:1 to the three pure
-- functions in app/services/scoring.py:
--   'first_to'               -- first player to reach the threshold wins outright (Farm Toss, Cornhole, Cornhole Extreme)
--   'first_to_bonus_round'   -- first to reach the threshold wins, unless tied with the leader at that moment, in which case play continues sudden-death until someone pulls strictly ahead (Horse Hoops)
--   'first_to_round_tiebreak'-- win condition is only checked at throws_per_round boundaries; if multiple players clear the threshold in the same round, the highest of those wins, and a tie for highest continues into further rounds until resolved (Tiki Toss / Ring & Hook)
--
-- Per the project's established gotcha (seed.sql edits don't reach the live
-- DB -- see migrations 004/005/006's headers), this migration is what
-- actually applies the change to the live database; seed.sql and
-- schema.sql are updated separately (seed.sql for fresh-install data,
-- schema.sql for a fresh project's baseline).
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: table/index creates are guarded, and every
-- insert is guarded by ON CONFLICT DO NOTHING (scoring_games.name) or a
-- natural unique constraint (game_score_events (game_id, label)).

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table if not exists scoring_games (
    id                  uuid primary key default gen_random_uuid(),
    name                text not null unique,
    rules_text          text not null default '',
    win_condition_text  text not null default '',
    win_condition_type  text not null check (win_condition_type in ('first_to', 'first_to_bonus_round', 'first_to_round_tiebreak')),
    win_threshold       integer not null check (win_threshold > 0),
    -- Only set for round-based games (Tiki Toss: 10 throws/round). Null for
    -- games whose win condition is checked after every single entry.
    throws_per_round    integer check (throws_per_round is null or throws_per_round > 0),
    created_at          timestamptz not null default now()
);

create table if not exists game_score_events (
    id          uuid primary key default gen_random_uuid(),
    game_id     uuid not null references scoring_games(id) on delete cascade,
    label       text not null,
    point_value integer not null check (point_value > 0),
    sort_order  integer not null default 0,
    created_at  timestamptz not null default now(),
    unique (game_id, label)
);

create index if not exists game_score_events_game_id_idx on game_score_events(game_id);

create table if not exists score_sheet_sessions (
    id            uuid primary key default gen_random_uuid(),
    game_id       uuid not null references scoring_games(id) on delete cascade,
    -- Simple list of player (or team, for Horse Hoops) names, entered fresh
    -- per session rather than a persistent roster -- matches the POC's
    -- single-tenant, walk-up-and-play scope.
    players       text[] not null,
    winner        text,
    completed_at  timestamptz,
    created_at    timestamptz not null default now()
);

create index if not exists score_sheet_sessions_game_id_idx on score_sheet_sessions(game_id);

create table if not exists score_entries (
    id             uuid primary key default gen_random_uuid(),
    session_id     uuid not null references score_sheet_sessions(id) on delete cascade,
    player_name    text not null,
    score_event_id uuid not null references game_score_events(id) on delete restrict,
    created_at     timestamptz not null default now()
);

create index if not exists score_entries_session_id_idx on score_entries(session_id);

-- ---------------------------------------------------------------------------
-- scoring_games (5) + game_score_events, per Plan.md 2.2's confirmed rule table
-- ---------------------------------------------------------------------------
insert into scoring_games (name, rules_text, win_condition_text, win_condition_type, win_threshold, throws_per_round) values
    (
        'Farm Toss',
        'Ring toss at animal targets around the farm.',
        'First to 21 wins.',
        'first_to',
        21,
        null
    ),
    (
        'Horse Hoops',
        'Team play. Toss a hoop onto the horse or around its neck.',
        'First to 10 wins. If teams are tied at or above 10, play continues in a bonus round until one team pulls ahead.',
        'first_to_bonus_round',
        10,
        null
    ),
    (
        'Cornhole',
        'Innings-based -- each player pitches all 4 bags per inning.',
        'First to 21 wins.',
        'first_to',
        21,
        null
    ),
    (
        'Cornhole Extreme',
        'Three-hole variant of Cornhole -- each player pitches all 4 bags per inning.',
        'First to 21 wins.',
        'first_to',
        21,
        null
    ),
    (
        'Tiki Toss / Ring & Hook',
        '10 throws per round.',
        'First to 100 wins. If multiple players reach 100 in the same round, the highest score wins. A tie for highest continues into further rounds until someone wins a round outright.',
        'first_to_round_tiebreak',
        100,
        10
    )
on conflict (name) do nothing;

-- Farm Toss: observed point values 2, 3, 6.
insert into game_score_events (game_id, label, point_value, sort_order)
select g.id, e.label, e.point_value, e.sort_order
from scoring_games g,
(values
    ('2-Point Ring', 2, 1),
    ('3-Point Ring', 3, 2),
    ('6-Point Ring', 6, 3)
) as e(label, point_value, sort_order)
where g.name = 'Farm Toss'
on conflict (game_id, label) do nothing;

-- Horse Hoops: Hit Horse (1), Blue/Yellow/Red Horse Neck (2/3/4).
insert into game_score_events (game_id, label, point_value, sort_order)
select g.id, e.label, e.point_value, e.sort_order
from scoring_games g,
(values
    ('Hit Horse', 1, 1),
    ('Blue Horse Neck', 2, 2),
    ('Yellow Horse Neck', 3, 3),
    ('Red Horse Neck', 4, 4)
) as e(label, point_value, sort_order)
where g.name = 'Horse Hoops'
on conflict (game_id, label) do nothing;

-- Cornhole: Woody (1), Cornhole/through the hole (3).
insert into game_score_events (game_id, label, point_value, sort_order)
select g.id, e.label, e.point_value, e.sort_order
from scoring_games g,
(values
    ('Woody', 1, 1),
    ('Cornhole', 3, 2)
) as e(label, point_value, sort_order)
where g.name = 'Cornhole'
on conflict (game_id, label) do nothing;

-- Cornhole Extreme: Woody (1), First/Second/Third Hole (2/3/4).
insert into game_score_events (game_id, label, point_value, sort_order)
select g.id, e.label, e.point_value, e.sort_order
from scoring_games g,
(values
    ('Woody', 1, 1),
    ('First Hole', 2, 2),
    ('Second Hole', 3, 3),
    ('Third Hole', 4, 4)
) as e(label, point_value, sort_order)
where g.name = 'Cornhole Extreme'
on conflict (game_id, label) do nothing;

-- Tiki Toss / Ring & Hook: Ting (1), Nassau (3), Bimini (5).
insert into game_score_events (game_id, label, point_value, sort_order)
select g.id, e.label, e.point_value, e.sort_order
from scoring_games g,
(values
    ('Ting', 1, 1),
    ('Nassau', 3, 2),
    ('Bimini', 5, 3)
) as e(label, point_value, sort_order)
where g.name = 'Tiki Toss / Ring & Hook'
on conflict (game_id, label) do nothing;
