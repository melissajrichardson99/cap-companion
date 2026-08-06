-- CAP Companion App — migration 006: staff-time comparison + relabeling
--
-- Three changes to the Puzzle Solving Timer (Plan.md 2.3), replacing the
-- leaderboard with a staff-time comparison:
--
--   (a) puzzle_challenges.target_time_seconds -> staff_time_seconds (same
--       column, clearer name now that it's an explicit staff-set reference
--       time shown on the result screen, not a vague "target").
--   (b) puzzle_attempts.hints_used (int, 0-3) -- how many hint tiers were
--       revealed during that specific attempt. The leaderboard itself (the
--       /leaderboard endpoint, rank_attempts, the UI toggle) is removed
--       app-side; no table to drop for it, puzzle_attempts stays.
--   (c) puzzle_challenges.description (short start-screen context text,
--       distinct from the existing hint tiers) + relabeled challenges:
--       single-challenge puzzles get 'Standard' (was 'Default'), and
--       Pyramid Puzzler / Hop Dots challenges become 'Challenge 1/2/3'
--       (was their descriptive names, which now live in `description`
--       instead, per the same "Get to the top." style text agreed for the
--       start screen).
--
-- Per the project's established gotcha (seed.sql edits don't reach the live
-- DB -- see migration 004/005's headers), this migration is what actually
-- applies the change to the live database; seed.sql is updated separately
-- for fresh installs.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: the column rename is guarded by an
-- information_schema check, added columns use IF NOT EXISTS, and every
-- label/description update matches on the pre-migration value (or is a
-- plain deterministic overwrite), so re-running is a no-op / same result.

-- ---------------------------------------------------------------------------
-- (a) target_time_seconds -> staff_time_seconds
-- ---------------------------------------------------------------------------
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_name = 'puzzle_challenges' and column_name = 'target_time_seconds'
    ) then
        alter table puzzle_challenges rename column target_time_seconds to staff_time_seconds;
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- (b) puzzle_attempts.hints_used
-- ---------------------------------------------------------------------------
alter table puzzle_attempts
    add column if not exists hints_used integer not null default 0 check (hints_used >= 0 and hints_used <= 3);

-- ---------------------------------------------------------------------------
-- (c) puzzle_challenges.description + relabeling
-- ---------------------------------------------------------------------------
alter table puzzle_challenges add column if not exists description text not null default '';

-- Single-challenge puzzles: 'Default' -> 'Standard'.
update puzzle_challenges
set label = 'Standard'
where label = 'Default';

-- Pyramid Puzzler: descriptive labels -> 'Challenge 1/2/3'.
update puzzle_challenges pc
set label = 'Challenge 1'
from puzzles p
where pc.puzzle_id = p.id and p.name = 'Pyramid Puzzler' and pc.label = 'Reach the Top';

update puzzle_challenges pc
set label = 'Challenge 2'
from puzzles p
where pc.puzzle_id = p.id and p.name = 'Pyramid Puzzler' and pc.label = 'Reach the Top, Then Exit From Start';

update puzzle_challenges pc
set label = 'Challenge 3'
from puzzles p
where pc.puzzle_id = p.id and p.name = 'Pyramid Puzzler' and pc.label = 'All 4 Corners + Center, Then Exit';

-- Hop Dots: descriptive labels -> 'Challenge 1/2'.
update puzzle_challenges pc
set label = 'Challenge 1'
from puzzles p
where pc.puzzle_id = p.id and p.name = 'Hop Dots' and pc.label = 'Corner to Corner and Back';

update puzzle_challenges pc
set label = 'Challenge 2'
from puzzles p
where pc.puzzle_id = p.id and p.name = 'Hop Dots' and pc.label = 'Visit All Corners';

-- Start-screen descriptions, keyed by (puzzle name, sort_order) since labels
-- above are now uniform across puzzles and sort_order is the stable key.
update puzzle_challenges pc
set description = v.description
from puzzles p, (values
    ('Pyramid Puzzler',    1, 'Get to the top.'),
    ('Pyramid Puzzler',    2, 'Get to the top, then leave from the starting block.'),
    ('Pyramid Puzzler',    3, 'Visit all four corners and the centre, then leave from the starting block.'),
    ('Hop Dots',           1, 'Start on any corner red dot, reach the red dot in the opposite corner, then return to start.'),
    ('Hop Dots',           2, 'Start on any corner red dot, visit all other corner dots clockwise or counter-clockwise, then return to start.'),
    ('Right Turn Only',    1, 'Get to the centre of the maze without taking any left turns.'),
    ('Math Maze',          1, 'Navigate from the start square to the finish square, moving in a straight line the number of tiles marked on your current tile.'),
    ('Red White and Blue', 1, 'Enter on the red tile at the bottom, exit on the blue tile at the top, alternating between red and blue tiles along the way.'),
    ('Big Mystery Maze',   1, 'Find your way through the maze to the centre.')
) as v(puzzle_name, sort_order, description)
where p.name = v.puzzle_name and pc.puzzle_id = p.id and pc.sort_order = v.sort_order;
