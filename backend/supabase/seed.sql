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
