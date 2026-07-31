-- CAP Companion App — Phase 1 seed data
-- Run after schema.sql. Idempotent-ish: map_nodes/minigames use ON CONFLICT (name)
-- DO NOTHING so re-running won't duplicate rows; the demo bingo card + its tiles
-- are only inserted the first time (guarded by a NOT EXISTS check) since a card
-- has no natural unique key to conflict on.
--
-- Source: CAP_Companion_App_TechSpec.md section 6.1 (map nodes) and 6.2 (bingo
-- tile pool). Halloween/Fall seasonal nodes are deliberately skipped per the
-- Phase 1 build instructions.

-- ---------------------------------------------------------------------------
-- map_nodes — Attractions (27)
-- ---------------------------------------------------------------------------
insert into map_nodes (name, category, description) values
    ('Arcade Pad',            'attraction', 'Coin-op arcade games.'),
    ('Pedal Karts',           'attraction', 'Pedal-powered go-karts on a short track.'),
    ('Tractor Ride',          'attraction', 'Guided tractor ride around the park.'),
    ('Mini-Golf',             'attraction', 'Themed mini-golf course.'),
    ('Archery',               'attraction', 'Supervised archery range.'),
    ('Tether Ball',           'attraction', 'Tether ball court.'),
    ('Chicken Bowl',          'attraction', 'Chicken-themed bowling game.'),
    ('Axe Throwing',          'attraction', 'Supervised axe throwing lanes.'),
    ('Farm Toss',             'attraction', 'Ring toss at animal targets, variable point values.'),
    ('Fort Slide',            'attraction', 'Play fort with slides.'),
    ('Playground',            'attraction', 'General playground equipment.'),
    ('Mystery Maze',          'attraction', 'Walk-through maze attraction.'),
    ('Blaster Balls',         'attraction', 'Foam ball blaster arena.'),
    ('Ground Games',          'attraction', 'Assorted lawn games area.'),
    ('Climbing Wall',         'attraction', 'Supervised climbing wall.'),
    ('Slide Tower',           'attraction', 'Multi-story slide tower.'),
    ('Rope Maze',             'attraction', 'Elevated rope maze/course.'),
    ('Soccer Game',           'attraction', 'Soccer target/skill game.'),
    ('Cornhole',              'attraction', 'Cornhole boards, first to 21, "Woody"/"Cornhole" scoring.'),
    ('Cornhole Extreme',      'attraction', 'Three-hole cornhole variant, first to 21.'),
    ('Horse Hoops',           'attraction', 'Team hoop-toss game, first to 10.'),
    ('Tiki Toss/Ring & Hook', 'attraction', 'Ring toss game, "Ting"/"Nassau"/"Bimini" scoring, first to 100.'),
    ('Pyramid Puzzler',       'attraction', 'Turn-on-color pyramid navigation puzzle.'),
    ('Hop Dots',              'attraction', 'Hop-the-dots-in-order puzzle (red, blue, yellow).'),
    ('Red White and Blue',    'attraction', 'Path puzzle: alternate colors, no repeats, retrace to solve.'),
    ('Math Maze',             'attraction', 'Number-tile maze, move the marked tile count per step.'),
    ('Right Turn Only',       'attraction', 'No-left-turn maze puzzle, 20-turn challenge.')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- map_nodes — Animals (5)
-- ---------------------------------------------------------------------------
insert into map_nodes (name, category, description) values
    ('Small Animals',        'animal', 'Small animals petting/viewing area.'),
    ('Kangaroos/Wallaroos',  'animal', 'Kangaroo and wallaroo habitat.'),
    ('Goats',                'animal', 'Goat habitat/feeding area.'),
    ('Alpacas/Sheep/Pigs',   'animal', 'Shared alpaca, sheep, and pig habitat.'),
    ('Capybaras & Emus',     'animal', 'Capybara and emu habitat.')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- map_nodes — Services & Food (7)
-- ---------------------------------------------------------------------------
insert into map_nodes (name, category, description) values
    ('Ticket Booth', 'service', 'Park entry ticketing.'),
    ('Restrooms',    'service', 'Public restrooms.'),
    ('Party Tents',  'service', 'Reserved party/event tents.'),
    ('Main Stage',   'service', 'Scheduled stage shows.'),
    ('Critter Cafe', 'food',    'Main park cafe.'),
    ('Sugar Shack',  'food',    'Snacks and sweets stand.'),
    ('General Store','food',    'Park gift and snack store.')
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
    (4, 3, 'Win a round of Gaga Ball',                      NULL),
    (4, 4, 'Beat a family member at Giant Checkers',        NULL)
) as t(row_index, col_index, label, node_name);
