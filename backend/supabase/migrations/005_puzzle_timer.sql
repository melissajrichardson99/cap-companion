-- CAP Companion App — migration 005: Puzzle Solving Timer tables + seed data
--
-- New feature (Plan.md 2.3), so unlike migrations 002-004 there's no existing
-- live table to alter — this creates puzzles/puzzle_challenges/puzzle_attempts
-- from scratch and seeds the 6 puzzles + their challenge variants. Per the
-- project's established gotcha (seed.sql alone never reaches the live DB —
-- see migration 004's header), the actual insert statements live here too,
-- not just in seed.sql.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: table/index creates are guarded, and every
-- insert is guarded by ON CONFLICT DO NOTHING (puzzles.name) or a natural
-- unique constraint (puzzle_challenges (puzzle_id, label)).

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table if not exists puzzles (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    rules_text  text not null default '',
    map_node_id uuid references map_nodes(id) on delete set null,
    created_at  timestamptz not null default now()
);

create table if not exists puzzle_challenges (
    id                   uuid primary key default gen_random_uuid(),
    puzzle_id            uuid not null references puzzles(id) on delete cascade,
    label                text not null,
    sort_order           integer not null default 0,
    target_time_seconds  integer check (target_time_seconds is null or target_time_seconds > 0),
    solution_type        text not null check (solution_type in ('exact', 'strategy', 'none')),
    hint_tier_1          text,
    hint_tier_2          text,
    hint_tier_3          text,
    created_at           timestamptz not null default now(),
    unique (puzzle_id, label)
);

create index if not exists puzzle_challenges_puzzle_id_idx on puzzle_challenges(puzzle_id);

create table if not exists puzzle_attempts (
    id              uuid primary key default gen_random_uuid(),
    challenge_id    uuid not null references puzzle_challenges(id) on delete cascade,
    elapsed_seconds integer not null check (elapsed_seconds > 0),
    created_at      timestamptz not null default now()
);

create index if not exists puzzle_attempts_challenge_id_idx on puzzle_attempts(challenge_id);

-- ---------------------------------------------------------------------------
-- puzzles (6) — map_node_id links to the existing sub-game nodes under
-- Ground Games (seed.sql), except Big Mystery Maze which links to the
-- existing "Mystery Maze" attraction node (same physical maze, different
-- name between the Plan.md puzzle table and the map node).
-- ---------------------------------------------------------------------------
insert into puzzles (name, rules_text, map_node_id) values
    (
        'Pyramid Puzzler',
        'Turn right on red, turn left on blue, go straight on yellow. Make choices on white squares. Start again if forced off the pyramid.',
        (select id from map_nodes where name = 'Pyramid Puzzler')
    ),
    (
        'Math Maze',
        'Start on the start square. Move in any straight direction the number of tiles marked on your current tile. One direction per move. No diagonal moves. Reach the finish square.',
        (select id from map_nodes where name = 'Math Maze')
    ),
    (
        'Hop Dots',
        'Hop the dots in order: red, blue, yellow — cycling for the whole path.',
        (select id from map_nodes where name = 'Hop Dots')
    ),
    (
        'Right Turn Only',
        'Stay on the paths. No turning around, no left turns. Don''t stop until you reach the center. Challenge: complete the maze in 20 turns.',
        (select id from map_nodes where name = 'Right Turn Only')
    ),
    (
        'Red White and Blue',
        'Enter on the bottom red tile, exit on the top blue tile. Stay on the paths, no turning around. Alternate red and blue — never two of the same color in a row. You''ll need to retrace your path to solve it.',
        (select id from map_nodes where name = 'Red White and Blue')
    ),
    (
        'Big Mystery Maze',
        'A walkthrough maze with a Scooby-Doo mystery theme. No posted step-by-step rules — just make your way through and see how fast you can finish.',
        (select id from map_nodes where name = 'Mystery Maze')
    )
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- puzzle_challenges
-- ---------------------------------------------------------------------------

-- Pyramid Puzzler (exact, 3 challenges)
insert into puzzle_challenges (puzzle_id, label, sort_order, solution_type, hint_tier_1, hint_tier_2, hint_tier_3)
select p.id, c.label, c.sort_order, c.solution_type, c.hint_tier_1, c.hint_tier_2, c.hint_tier_3
from puzzles p,
(values
    (
        'Reach the Top',
        1,
        'exact',
        'White tiles are the only ones where you choose your own direction — everywhere else the color decides for you.',
        'Start by turning right, then look for a white tile to redirect yourself toward the center.',
        'Enter facing North. Red tile: turn right (now facing East). Move to a white tile: choose West. Red tile: turn right (now facing North). Move to a white tile: choose North. Blue tile: turn left (now facing West). Move to a white tile: choose East. Blue tile: turn left (now facing North) into the CENTER.'
    ),
    (
        'Reach the Top, Then Exit From Start',
        2,
        'exact',
        'Same tile rules as before — white tiles are your only free choices, and you''ll need to leave the center the way you came to head back toward the exit.',
        'Reach the center exactly as in "Reach the Top", then keep following the color rules back down toward the Start block — look for another white tile partway down to redirect yourself toward the exit.',
        'Reach the center exactly as in "Reach the Top": enter facing North, red (turn right), white (choose West), red (turn right), white (choose North), blue (turn left), white (choose East), blue (turn left) into CENTER. Then continue: blue, turn left (now facing South). White tile: choose East. Red tile: turn right (facing South). White tile: choose West. Red tile: turn right (facing South). White tile: choose East. Red tile: turn right, and exit south through Start.'
    ),
    (
        'All 4 Corners + Center, Then Exit',
        3,
        'exact',
        'White tiles are the only ones where you choose your own direction — everywhere else the color decides for you.',
        'Start by turning right, then use white tiles to steer yourself toward each corner in turn before finishing at the center and heading back out through Start.',
        'Enter grid at (6,3) facing N [red]
→ (6,4) facing E [white]
→ (5,4) facing N [red]
→ (5,5) facing E [white]
→ (6,5) facing S [blue]
→ (6,6) facing E [white]
→ (5,6) facing N [yellow]
→ (4,6) facing N [white]
→ (4,5) facing W [blue]
→ (5,5) facing S [white]
→ (4,5) facing N [blue]
→ (4,4) facing W [white]
→ (3,4) facing N [yellow]
→ (2,4) facing N [white]
→ (1,4) facing N [red]
→ (1,5) facing E [white]
→ (0,5) facing N [red]
→ (0,6) facing E [white]
→ (1,6) facing S [yellow]
→ (2,6) facing S [white]
→ (3,6) facing S [red]
→ (3,5) facing W [white]
→ (3,4) facing W [yellow]
→ (3,3) facing W [CENTER]
→ (3,2) facing W [yellow]
→ (3,1) facing W [white]
→ (2,1) facing N [blue]
→ (2,0) facing W [white]
→ (1,0) facing N [yellow]
→ (0,0) facing N [white] — corner 1: top-left
→ (1,0) facing S [yellow]
→ (2,0) facing S [white]
→ (3,0) facing S [yellow]
→ (4,0) facing S [white]
→ (5,0) facing S [blue]
→ (5,1) facing E [white]
→ (5,0) facing W [blue]
→ (6,0) facing S [white] — corner 2: bottom-left
→ (6,1) facing E [yellow]
→ (6,2) facing E [white]
→ (6,3) facing E [red]
→ EXIT via Start block (facing S) — COMPLETE'
    )
) as c(label, sort_order, solution_type, hint_tier_1, hint_tier_2, hint_tier_3)
where p.name = 'Pyramid Puzzler'
on conflict (puzzle_id, label) do nothing;

-- Math Maze (exact, 1 challenge)
insert into puzzle_challenges (puzzle_id, label, sort_order, solution_type, hint_tier_1, hint_tier_2, hint_tier_3)
select p.id, 'Default', 1, 'exact',
    'You can move in any of the 4 directions from a tile, not just where its arrow happens to point.',
    'The first move is up 1, then left 1.',
    'Up 1, left 1, up 2, up 2, down 1, right 3, left 2, down 1 — Finish (8 moves total).'
from puzzles p
where p.name = 'Math Maze'
on conflict (puzzle_id, label) do nothing;

-- Hop Dots (strategy, 2 challenges)
insert into puzzle_challenges (puzzle_id, label, sort_order, solution_type, hint_tier_1, hint_tier_2, hint_tier_3)
select p.id, c.label, c.sort_order, 'strategy', c.hint_tier_1, c.hint_tier_2, c.hint_tier_3
from puzzles p,
(values
    (
        'Corner to Corner and Back',
        1,
        'Remember the order — red, blue, yellow, always cycling.',
        'Plan your color cycle backward from the opposite corner too, so your return trip lands on the right color without breaking the pattern.',
        'There''s no single fixed path here — as long as every hop follows red, blue, yellow in order (cycling) both there and back, you''ve solved it. Focus on reaching the opposite corner on a red dot, then reverse the pattern to return.'
    ),
    (
        'Visit All Corners',
        2,
        'Remember the order — red, blue, yellow, always cycling.',
        'Pick one rotational direction (clockwise or counter-clockwise) and stick with it all the way around the corners before heading back.',
        'Many valid solutions exist — the key constraint is the color cycle, not the exact tiles. Starting from any red corner, work your way around the other corners in one consistent rotational direction, keeping every hop on the red-blue-yellow cycle, then return to start the same way.'
    )
) as c(label, sort_order, hint_tier_1, hint_tier_2, hint_tier_3)
where p.name = 'Hop Dots'
on conflict (puzzle_id, label) do nothing;

-- Right Turn Only (strategy, 1 challenge)
insert into puzzle_challenges (puzzle_id, label, sort_order, solution_type, hint_tier_1, hint_tier_2, hint_tier_3)
select p.id, 'Default', 1, 'strategy',
    'This works like every no-left-turn maze — try right first, then straight, and only go left if nothing else is open.',
    'At every junction, check your options in this order: right turn, then straight, then left — take the first one that''s actually open. This "keep a hand on the right-hand wall" approach solves any maze without shortcuts, including this one.',
    'Follow the right-hand rule the whole way: at each junction, always take the right-most open path before considering straight. Left turns aren''t allowed here anyway, so in practice that means take right whenever it''s open, otherwise go straight. Keep going without ever turning around, and you''ll reach the center in 20 turns.'
from puzzles p
where p.name = 'Right Turn Only'
on conflict (puzzle_id, label) do nothing;

-- Red White and Blue (strategy, 1 challenge)
insert into puzzle_challenges (puzzle_id, label, sort_order, solution_type, hint_tier_1, hint_tier_2, hint_tier_3)
select p.id, 'Default', 1, 'strategy',
    'You can''t hit two reds or two blues back to back.',
    'The board''s own hint is the real secret — a straight run through won''t work.',
    'You''ll need to walk part of the maze, then retrace your steps back over the same tiles to keep the red/blue pattern legal, rather than trying to find one continuous forward path.'
from puzzles p
where p.name = 'Red White and Blue'
on conflict (puzzle_id, label) do nothing;

-- Big Mystery Maze (none, 1 challenge, no hints — timer/leaderboard only)
insert into puzzle_challenges (puzzle_id, label, sort_order, solution_type)
select p.id, 'Default', 1, 'none'
from puzzles p
where p.name = 'Big Mystery Maze'
on conflict (puzzle_id, label) do nothing;
