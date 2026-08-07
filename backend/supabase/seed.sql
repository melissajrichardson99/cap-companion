-- CAP Companion App — Phase 1 seed data
-- Run after schema.sql. Idempotent-ish: map_nodes/minigames use ON CONFLICT (name)
-- DO NOTHING so re-running won't duplicate rows; the demo bingo card + its tiles
-- are only inserted the first time (guarded by a NOT EXISTS check) since a card
-- has no natural unique key to conflict on.
--
-- Source: CAP_Companion_App_TechSpec.md section 6.1 (map nodes) and 6.2 (bingo
-- tile pool). Halloween/Fall seasonal nodes are deliberately skipped per the
-- Phase 1 build instructions.
--
-- x_pct/y_pct: percentage position on the hand-drawn park map background.
-- Nodes not yet placed on the map (the newer Cornhole/puzzle additions) are
-- left null and render in the Map screen's fallback list instead of a pin.
--
-- parent_node_id: Cornhole, Cornhole Extreme, Horse Hoops, Tiki Toss/Ring &
-- Hook, Pyramid Puzzler, Hop Dots, Red White and Blue, Math Maze, Right Turn
-- Only, and Gaga Ball are sub-games of a single physical pad (Arcade Pad or
-- Ground Games), not their own map location — they're parented rather than
-- given their own x_pct/y_pct, so the Map UI shows one pin per pad whose
-- popup lists the games underneath.

-- ---------------------------------------------------------------------------
-- map_nodes — Attractions (28)
-- ---------------------------------------------------------------------------
insert into map_nodes (name, category, description, x_pct, y_pct) values
    ('Arcade Pad',            'attraction', 'Coin-op arcade games.',                                            9.7,  43.7),
    ('Pedal Karts',           'attraction', 'Pedal-powered go-karts on a short track.',                         9.7,  33.4),
    ('Tractor Ride',          'attraction', 'Guided tractor ride around the park.',                             10.5, 23.1),
    ('Mini-Golf',             'attraction', 'Themed mini-golf course.',                                         28.6, 24.2),
    ('Archery',               'attraction', 'Supervised archery range.',                                        25.5, 31.6),
    ('Tether Ball',           'attraction', 'Tether ball court.',                                                58.1, 20.5),
    ('Chicken Bowl',          'attraction', 'Chicken-themed bowling game.',                                     63.9, 22.4),
    ('Axe Throwing',          'attraction', 'Supervised axe throwing lanes.',                                   58.5, 33.8),
    ('Farm Toss',             'attraction', 'Ring toss at animal targets, variable point values.',              62.4, 38.7),
    ('Fort Slide',            'attraction', 'Play fort with slides.',                                           65.9, 29.1),
    ('Playground',            'attraction', 'General playground equipment.',                                    69.0, 44.1),
    ('Mystery Maze',          'attraction', 'Walk-through maze attraction.',                                    71.3, 65.0),
    ('Blaster Balls',         'attraction', 'Foam ball blaster arena.',                                         43.7, 67.3),
    ('Ground Games',          'attraction', 'Assorted lawn games area.',                                        47.7, 31.1),
    ('Climbing Wall',         'attraction', 'Supervised climbing wall.',                                        36.8, 35.6),
    ('Slide Tower',           'attraction', 'Multi-story slide tower.',                                         34.3, 30.5),
    ('Rope Maze',             'attraction', 'Elevated rope maze/course.',                                       89.9, 80.3),
    ('Soccer Game',           'attraction', 'Soccer target/skill game.',                                        60.8, 57.8),
    ('Cornhole',              'attraction', 'Cornhole boards, first to 21, "Woody"/"Cornhole" scoring.',        NULL, NULL),
    ('Cornhole Extreme',      'attraction', 'Three-hole cornhole variant, first to 21.',                        NULL, NULL),
    ('Horse Hoops',           'attraction', 'Team hoop-toss game, first to 10.',                                NULL, NULL),
    ('Tiki Toss/Ring & Hook', 'attraction', 'Ring toss game, "Ting"/"Nassau"/"Bimini" scoring, first to 100.',  NULL, NULL),
    ('Pyramid Puzzler',       'attraction', 'Turn-on-color pyramid navigation puzzle.',                         NULL, NULL),
    ('Hop Dots',              'attraction', 'Hop-the-dots-in-order puzzle (red, blue, yellow).',                NULL, NULL),
    ('Red White and Blue',    'attraction', 'Path puzzle: alternate colors, no repeats, retrace to solve.',     NULL, NULL),
    ('Math Maze',             'attraction', 'Number-tile maze, move the marked tile count per step.',           NULL, NULL),
    ('Right Turn Only',       'attraction', 'No-left-turn maze puzzle, 20-turn challenge.',                     NULL, NULL),
    ('Gaga Ball',             'attraction', 'Gaga ball pit.',                                                    NULL, NULL)
on conflict (name) do nothing;

-- Cornhole/Cornhole Extreme/Horse Hoops/Tiki Toss and the 5 puzzles above are
-- really sub-games of one physical pad each, not separate map locations — set
-- their parent so the Map UI shows one pin (Arcade Pad / Ground Games) whose
-- popup lists the games, instead of 9 extra unpositioned pins. Gaga Ball is
-- unpositioned for the same reason: it's a Ground Games sub-game too.
update map_nodes
set parent_node_id = (select id from map_nodes where name = 'Arcade Pad')
where name in ('Cornhole', 'Cornhole Extreme', 'Horse Hoops', 'Tiki Toss/Ring & Hook');

update map_nodes
set parent_node_id = (select id from map_nodes where name = 'Ground Games')
where name in ('Red White and Blue', 'Pyramid Puzzler', 'Hop Dots', 'Math Maze', 'Right Turn Only', 'Gaga Ball');

-- ---------------------------------------------------------------------------
-- map_nodes — Animals (7)
-- ---------------------------------------------------------------------------
insert into map_nodes (name, category, description, x_pct, y_pct) values
    ('Small Animals',              'animal', 'Small animals petting/viewing area.',                  57.1, 79.8),
    ('Kangaroos/Wallaroos',        'animal', 'Kangaroo and wallaroo habitat.',                        43.7, 83.2),
    ('Goats',                      'animal', 'Goat habitat/feeding area.',                            55.8, 89.5),
    ('Alpacas/Sheep/Pigs',         'animal', 'Shared alpaca, sheep, and pig habitat.',                 65.1, 89.4),
    ('Capybaras & Emus',           'animal', 'Capybara and emu habitat.',                             77.0, 90.1),
    ('Wallaroos (viewing only)',   'animal', 'Wallaroo viewing overlook (viewing only, no entry).',   78.3, 78.7),
    ('Private Event Animal Space', 'animal', 'Reserved animal encounter space for private events.',   17.1, 61.6)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- map_nodes — Services & Food (10)
-- ---------------------------------------------------------------------------
insert into map_nodes (name, category, description, x_pct, y_pct) values
    ('Ticket Booth',          'service', 'Park entry ticketing.',                35.2, 70.2),
    ('Restrooms',             'service', 'Public restrooms.',                    19.1, 47.7),
    ('Party Tents',           'service', 'Reserved party/event tents.',          31.0, 47.5),
    ('Main Stage',            'service', 'Scheduled stage shows.',               51.5, 64.4),
    ('Admin Offices',         'service', 'Park administrative offices.',         21.8, 65.3),
    ('Animal Stage',          'service', 'Scheduled animal show stage.',         62.0, 75.0),
    ('Critter Cafe',          'food',    'Main park cafe.',                      31.3, 59.1),
    ('Granny Ann''s Kitchen', 'food',    'Kitchen and dining stand.',            31.4, 55.9),
    ('Sugar Shack',           'food',    'Snacks and sweets stand.',             33.7, 53.0),
    ('General Store',         'food',    'Park gift and snack store.',           26.3, 70.8)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- minigames — Phase 1 pool (5)
-- ---------------------------------------------------------------------------
insert into minigames (name, engine_group, theme, target_duration_seconds, phase) values
    ('Whack-a-Capybara', 'reaction_timing', 'capybara',     30, 1),
    ('Pattern Repeat',   'reaction_timing', 'farm animals', 30, 1),
    ('Card Flip Pairs',  'grid_drag',       'park animals', 30, 1),
    ('Mini Maze',        'grid_drag',       'none',         30, 1),
    ('Mini Snake',       'standalone',      'none',         30, 1)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- minigames — Phase 2 pool (all 5 built — map_bingo.CURRENT_MINIGAME_PHASE
-- bumped to 2, so these are now in the live draw pool alongside Phase 1)
-- ---------------------------------------------------------------------------
insert into minigames (name, engine_group, theme, target_duration_seconds, phase) values
    ('Mini Platformer',   'standalone',  'kangaroo', 30, 2),
    ('Obstacle Dodge',    'auto_scroll', 'alpaca',   30, 2),
    ('Digital Ring Toss', 'standalone',  'none',     30, 2),
    ('Bug Net Swipe',     'standalone',  'none',     30, 2),
    ('Sort the Species',  'auto_scroll', 'none',     30, 2)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- bingo_cards + bingo_tiles — one demo 25-tile card (tech spec section 6.2),
-- linked to map_nodes above wherever a tile implies a real park section.
-- Only seeded once (skipped on re-run) since bingo_cards has no natural
-- unique key to conflict on.
-- ---------------------------------------------------------------------------
with new_card as (
    insert into bingo_cards (owner_label)
    select 'Demo Family'
    where not exists (select 1 from bingo_cards where owner_label = 'Demo Family')
    returning id
)
insert into bingo_tiles (card_id, row_index, col_index, label, linked_map_node_id)
select nc.id, t.row_index, t.col_index, t.label,
       (select id from map_nodes where name = t.node_name)
from new_card nc,
(values
    (0, 0, 'Visit the Capybara & Emu habitat',            'Capybaras & Emus'),
    (0, 1, 'Visit the Kangaroo/Wallaroo section',          'Kangaroos/Wallaroos'),
    (0, 2, 'Say hi to the Goats',                          'Goats'),
    (0, 3, 'Visit the Alpacas, Sheep & Pigs',               'Alpacas/Sheep/Pigs'),
    (0, 4, 'Check out the Small Animals area',              'Small Animals'),
    (1, 0, 'Try the Farm Toss game',                        'Farm Toss'),
    (1, 1, 'Win a round at Cornhole',                       'Cornhole'),
    (1, 2, 'Take on Cornhole Extreme',                      'Cornhole Extreme'),
    (1, 3, 'Score big at Horse Hoops',                      'Horse Hoops'),
    (1, 4, 'Land a Bimini at Tiki Toss / Ring & Hook',      'Tiki Toss/Ring & Hook'),
    (2, 0, 'Beat the challenge time at Hop Dots',           'Hop Dots'),
    (2, 1, 'Solve the Pyramid Puzzler',                     'Pyramid Puzzler'),
    (2, 2, 'Complete Red, White and Blue',                  'Red White and Blue'),
    (2, 3, 'Find your way through Math Maze',               'Math Maze'),
    (2, 4, 'Finish Right Turn Only in 20 turns',            'Right Turn Only'),
    (3, 0, 'Take a spin on the Tractor Ride',               'Tractor Ride'),
    (3, 1, 'Race the Pedal Karts',                          'Pedal Karts'),
    (3, 2, 'Sink a hole-in-one at Mini-Golf',                'Mini-Golf'),
    (3, 3, 'Hit a bullseye at Archery',                     'Archery'),
    (3, 4, 'Knock ''em down at Chicken Bowl',                'Chicken Bowl'),
    (4, 0, 'Take your best swing at Axe Throwing',          'Axe Throwing'),
    (4, 1, 'Find the way out of Mystery Maze',              'Mystery Maze'),
    (4, 2, 'Conquer the Climbing Wall',                     'Climbing Wall'),
    (4, 3, 'Win a round of Gaga Ball',                      'Gaga Ball'),
    (4, 4, 'Beat a family member at Giant Checkers',        NULL)
) as t(row_index, col_index, label, node_name);

-- ---------------------------------------------------------------------------
-- puzzles + puzzle_challenges — Puzzle Solving Timer (Plan.md 2.3), 6 puzzles.
-- Matches the live-DB state after migrations 005_puzzle_timer.sql and
-- 006_puzzle_staff_time_and_labels.sql (labels/descriptions baked in
-- directly here rather than replayed as a separate rename step) — those
-- migrations are what actually apply this to the live database (the known
-- seed.sql-vs-live-DB gotcha applies here too), this file is the local
-- fresh-install / documentation copy.
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

insert into puzzle_challenges (puzzle_id, label, sort_order, solution_type, description, hint_tier_1, hint_tier_2, hint_tier_3)
select p.id, c.label, c.sort_order, c.solution_type, c.description, c.hint_tier_1, c.hint_tier_2, c.hint_tier_3
from puzzles p,
(values
    (
        'Challenge 1',
        1,
        'exact',
        'Get to the top.',
        'White tiles are the only ones where you choose your own direction — everywhere else the color decides for you.',
        'Start by turning right, then look for a white tile to redirect yourself toward the center.',
        'Enter facing North. Red tile: turn right (now facing East). Move to a white tile: choose West. Red tile: turn right (now facing North). Move to a white tile: choose North. Blue tile: turn left (now facing West). Move to a white tile: choose East. Blue tile: turn left (now facing North) into the CENTER.'
    ),
    (
        'Challenge 2',
        2,
        'exact',
        'Get to the top, then leave from the starting block.',
        'Same tile rules as before — white tiles are your only free choices, and you''ll need to leave the center the way you came to head back toward the exit.',
        'Reach the center exactly as in "Reach the Top", then keep following the color rules back down toward the Start block — look for another white tile partway down to redirect yourself toward the exit.',
        'Reach the center exactly as in "Reach the Top": enter facing North, red (turn right), white (choose West), red (turn right), white (choose North), blue (turn left), white (choose East), blue (turn left) into CENTER. Then continue: blue, turn left (now facing South). White tile: choose East. Red tile: turn right (facing South). White tile: choose West. Red tile: turn right (facing South). White tile: choose East. Red tile: turn right, and exit south through Start.'
    ),
    (
        'Challenge 3',
        3,
        'exact',
        'Visit all four corners and the centre, then leave from the starting block.',
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
) as c(label, sort_order, solution_type, description, hint_tier_1, hint_tier_2, hint_tier_3)
where p.name = 'Pyramid Puzzler'
on conflict (puzzle_id, label) do nothing;

insert into puzzle_challenges (puzzle_id, label, sort_order, solution_type, description, hint_tier_1, hint_tier_2, hint_tier_3)
select p.id, 'Standard', 1, 'exact',
    'Navigate from the start square to the finish square, moving in a straight line the number of tiles marked on your current tile.',
    'You can move in any of the 4 directions from a tile, not just where its arrow happens to point.',
    'The first move is up 1, then left 1.',
    'Up 1, left 1, up 2, up 2, down 1, right 3, left 2, down 1 — Finish (8 moves total).'
from puzzles p
where p.name = 'Math Maze'
on conflict (puzzle_id, label) do nothing;

insert into puzzle_challenges (puzzle_id, label, sort_order, solution_type, description, hint_tier_1, hint_tier_2, hint_tier_3)
select p.id, c.label, c.sort_order, 'strategy', c.description, c.hint_tier_1, c.hint_tier_2, c.hint_tier_3
from puzzles p,
(values
    (
        'Challenge 1',
        1,
        'Start on any corner red dot, reach the red dot in the opposite corner, then return to start.',
        'Remember the order — red, blue, yellow, always cycling.',
        'Plan your color cycle backward from the opposite corner too, so your return trip lands on the right color without breaking the pattern.',
        'There''s no single fixed path here — as long as every hop follows red, blue, yellow in order (cycling) both there and back, you''ve solved it. Focus on reaching the opposite corner on a red dot, then reverse the pattern to return.'
    ),
    (
        'Challenge 2',
        2,
        'Start on any corner red dot, visit all other corner dots clockwise or counter-clockwise, then return to start.',
        'Remember the order — red, blue, yellow, always cycling.',
        'Pick one rotational direction (clockwise or counter-clockwise) and stick with it all the way around the corners before heading back.',
        'Many valid solutions exist — the key constraint is the color cycle, not the exact tiles. Starting from any red corner, work your way around the other corners in one consistent rotational direction, keeping every hop on the red-blue-yellow cycle, then return to start the same way.'
    )
) as c(label, sort_order, description, hint_tier_1, hint_tier_2, hint_tier_3)
where p.name = 'Hop Dots'
on conflict (puzzle_id, label) do nothing;

insert into puzzle_challenges (puzzle_id, label, sort_order, solution_type, description, hint_tier_1, hint_tier_2, hint_tier_3)
select p.id, 'Standard', 1, 'strategy',
    'Get to the centre of the maze without taking any left turns.',
    'This works like every no-left-turn maze — try right first, then straight, and only go left if nothing else is open.',
    'At every junction, check your options in this order: right turn, then straight, then left — take the first one that''s actually open. This "keep a hand on the right-hand wall" approach solves any maze without shortcuts, including this one.',
    'Follow the right-hand rule the whole way: at each junction, always take the right-most open path before considering straight. Left turns aren''t allowed here anyway, so in practice that means take right whenever it''s open, otherwise go straight. Keep going without ever turning around, and you''ll reach the center in 20 turns.'
from puzzles p
where p.name = 'Right Turn Only'
on conflict (puzzle_id, label) do nothing;

insert into puzzle_challenges (puzzle_id, label, sort_order, solution_type, description, hint_tier_1, hint_tier_2, hint_tier_3)
select p.id, 'Standard', 1, 'strategy',
    'Enter on the red tile at the bottom, exit on the blue tile at the top, alternating between red and blue tiles along the way.',
    'You can''t hit two reds or two blues back to back.',
    'The board''s own hint is the real secret — a straight run through won''t work.',
    'You''ll need to walk part of the maze, then retrace your steps back over the same tiles to keep the red/blue pattern legal, rather than trying to find one continuous forward path.'
from puzzles p
where p.name = 'Red White and Blue'
on conflict (puzzle_id, label) do nothing;

insert into puzzle_challenges (puzzle_id, label, sort_order, solution_type, description)
select p.id, 'Standard', 1, 'none', 'Find your way through the maze to the centre.'
from puzzles p
where p.name = 'Big Mystery Maze'
on conflict (puzzle_id, label) do nothing;

-- ---------------------------------------------------------------------------
-- scoring_games / game_score_events (Scoring Sheet, plan 2.2)
-- Mini Golf and Archery deliberately excluded — no confirmed rules yet.
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

insert into game_score_events (game_id, label, point_value, sort_order)
select g.id, e.label, e.point_value, e.sort_order
from scoring_games g,
(values
    ('Woody', 1, 1),
    ('Cornhole', 3, 2)
) as e(label, point_value, sort_order)
where g.name = 'Cornhole'
on conflict (game_id, label) do nothing;

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

-- ---------------------------------------------------------------------------
-- hunt_characters / hunt_challenges / hunt_progress (Scavenger Hunt).
-- Matches the live-DB state after migration 008_scavenger_hunt.sql (which is
-- what actually applies this to the live database -- the known
-- seed.sql-vs-live-DB gotcha applies here too, this file is the local
-- fresh-install / documentation copy). Capybara's content is
-- source: 'park_verified' in metadata; the other four are
-- source: 'placeholder_general_knowledge', pending a real fact-check pass.
-- ---------------------------------------------------------------------------
insert into hunt_characters (name, species_category, minigame_slug, sort_order) values
    ('Kangaroo', 'marsupial', 'mini_platformer', 1),
    ('Pig',      'other',     'pattern_repeat',  2),
    ('Capybara', 'rodent',    'whack_a_capybara',3),
    ('Snake',    'other',     'mini_snake',      4),
    ('Sloth',    'other',     'mini_maze',       5)
on conflict (name) do nothing;

insert into hunt_challenges (character_id, order_index, type, content, metadata)
select c.id, v.order_index, v.type, v.content::jsonb, v.metadata::jsonb
from hunt_characters c,
(values
    (1, 'mc',
     '{"question":"What do you call a group of kangaroos?","options":["A mob","A pack","A herd","A troop"],"answer_index":0}',
     '{"source":"placeholder_general_knowledge"}'),
    (2, 'matching',
     '{"pairs":[{"left":"Joey","right":"a baby kangaroo"},{"left":"Pouch","right":"where a joey grows"},{"left":"Marsupial","right":"the mammal group kangaroos belong to"},{"left":"Mob","right":"a group of kangaroos"},{"left":"Boomer","right":"a large male kangaroo"}]}',
     '{"source":"placeholder_general_knowledge"}'),
    (3, 'minigame',
     '{"minigame_slug":"mini_platformer"}',
     '{"source":"placeholder_general_knowledge"}')
) as v(order_index, type, content, metadata)
where c.name = 'Kangaroo'
on conflict (character_id, order_index) do nothing;

insert into hunt_challenges (character_id, order_index, type, content, metadata)
select c.id, v.order_index, v.type, v.content::jsonb, v.metadata::jsonb
from hunt_characters c,
(values
    (1, 'mc',
     '{"question":"How do pigs cool themselves down, since they barely sweat?","options":["Rolling in mud","Panting like a dog","Hiding in shade only","They don''t need to"],"answer_index":0}',
     '{"source":"placeholder_general_knowledge"}'),
    (2, 'mc',
     '{"question":"Pigs are considered one of the smartest animals alive. Studies often compare their intelligence to which animals?","options":["Goldfish","Dolphins and primates","Reptiles","Dogs only"],"answer_index":1}',
     '{"source":"placeholder_general_knowledge"}'),
    (3, 'minigame',
     '{"minigame_slug":"pattern_repeat"}',
     '{"source":"placeholder_general_knowledge"}')
) as v(order_index, type, content, metadata)
where c.name = 'Pig'
on conflict (character_id, order_index) do nothing;

insert into hunt_challenges (character_id, order_index, type, content, metadata)
select c.id, v.order_index, v.type, v.content::jsonb, v.metadata::jsonb
from hunt_characters c,
(values
    (1, 'mc',
     '{"question":"What is a group of capybaras called?","options":["A herd","A pack","A colony","A raft"],"answer_index":0}',
     '{"source":"park_verified"}'),
    (2, 'true_false_set',
     '{"statements":[{"text":"Capybaras can stay underwater up to five minutes","answer":true},{"text":"Capybaras are the smallest rodent in the world","answer":false},{"text":"Capybaras are native to Central and South America","answer":true}]}',
     '{"source":"park_verified"}'),
    (3, 'minigame',
     '{"minigame_slug":"whack_a_capybara"}',
     '{"source":"park_verified"}')
) as v(order_index, type, content, metadata)
where c.name = 'Capybara'
on conflict (character_id, order_index) do nothing;

insert into hunt_challenges (character_id, order_index, type, content, metadata)
select c.id, v.order_index, v.type, v.content::jsonb, v.metadata::jsonb
from hunt_characters c,
(values
    (1, 'mc',
     '{"question":"How do snakes primarily sense their surroundings, beyond sight?","options":["By smelling with their tongue","Whiskers","Ears","Their tail"],"answer_index":0}',
     '{"source":"placeholder_general_knowledge"}'),
    (2, 'image_mc',
     '{"scrambled":"CSLAE","unscrambled":"SCALE","image_alt":"Close-up photo of snake scale texture","question":"What covers a snake''s body?","options":["Scale","Fur","Feather","Shell"],"answer_index":0}',
     '{"source":"placeholder_general_knowledge"}'),
    (3, 'minigame',
     '{"minigame_slug":"mini_snake"}',
     '{"source":"placeholder_general_knowledge"}')
) as v(order_index, type, content, metadata)
where c.name = 'Snake'
on conflict (character_id, order_index) do nothing;

insert into hunt_challenges (character_id, order_index, type, content, metadata)
select c.id, v.order_index, v.type, v.content::jsonb, v.metadata::jsonb
from hunt_characters c,
(values
    (1, 'mc',
     '{"question":"About how many hours a day do sloths typically sleep?","options":["4-6","8-10","10-15","20+"],"answer_index":2}',
     '{"source":"placeholder_general_knowledge"}'),
    (2, 'true_false_set',
     '{"statements":[{"text":"Sloths are excellent swimmers","answer":true},{"text":"Sloths spend most of their lives upside down in trees","answer":true},{"text":"Sloths are fast runners on the ground","answer":false}]}',
     '{"source":"placeholder_general_knowledge"}'),
    (3, 'minigame',
     '{"minigame_slug":"mini_maze"}',
     '{"source":"placeholder_general_knowledge"}')
) as v(order_index, type, content, metadata)
where c.name = 'Sloth'
on conflict (character_id, order_index) do nothing;

insert into hunt_progress (character_id)
select c.id from hunt_characters c
on conflict (character_id) do nothing;

-- ---------------------------------------------------------------------------
-- encyclopedia_entries / scannable_codes (QR scanning).
-- Matches the live-DB state after migration 009_scan_codes.sql (which is
-- what actually applies this to the live database -- same seed.sql-vs-live-DB
-- gotcha as every table above). 5 stub Encyclopedia entries, distinct from
-- the 5 hunt characters so a scanned sign never doubles as a hunt spoiler.
-- ---------------------------------------------------------------------------
insert into encyclopedia_entries (animal_name, status) values
    ('Red Panda', 'placeholder'),
    ('Flamingo',  'placeholder'),
    ('Meerkat',   'placeholder'),
    ('Otter',     'placeholder'),
    ('Peacock',   'placeholder')
on conflict (animal_name) do nothing;

insert into scannable_codes (code, hunt_character_id)
select v.code, c.id
from hunt_characters c
join (values
    ('brave-otter',  'Kangaroo'),
    ('happy-panda',  'Pig'),
    ('calm-turtle',  'Capybara'),
    ('quick-falcon', 'Snake'),
    ('sleepy-koala', 'Sloth')
) as v(code, name) on v.name = c.name
on conflict (code) do nothing;

insert into scannable_codes (code, encyclopedia_entry_id)
select v.code, e.id
from encyclopedia_entries e
join (values
    ('jolly-zebra',   'Red Panda'),
    ('silly-badger',  'Flamingo'),
    ('sunny-beaver',  'Meerkat'),
    ('lucky-giraffe', 'Otter'),
    ('proud-eagle',   'Peacock')
) as v(code, animal_name) on v.animal_name = e.animal_name
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- collectibles (Cobb Coins) -- fixture content. Thresholds are cumulative
-- totals across every award source (bingo tiles, puzzle completions, hunt
-- characters, scoring sheet wins all feed the same running total), tuned to
-- be reachable through normal play rather than deliberately grindy.
-- ---------------------------------------------------------------------------
insert into collectibles (name, icon, unlock_threshold) values
    ('Bronze Explorer',   '🥉', 10),
    ('Silver Adventurer', '🥈', 30),
    ('Gold Champion',     '🥇', 60),
    ('Cobb''s Legend',    '🏆', 100)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- coin_awards (Cobb Coins ledger) -- intentionally no seed rows, same as
-- staff_requests below. It is runtime guest-generated data (see migration
-- 011_cobb_coins.sql), not fixture content -- a fresh install starts with
-- zero coins earned.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- staff_requests (Contact Staff) -- intentionally no seed rows. It is
-- runtime guest-generated data (see migration 010_contact_staff.sql), not
-- fixture content -- a fresh install starts with zero requests.
-- ---------------------------------------------------------------------------
