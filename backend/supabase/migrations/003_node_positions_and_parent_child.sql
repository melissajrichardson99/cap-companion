-- CAP Companion App — migration 003: corrected positions + parent/child nodes
--
-- Three independent changes bundled together (all backend/DB changes for this
-- batch of work), safe to run more than once:
--
--   (a) correct x_pct/y_pct on all 35 positioned map_nodes. Migration 002's
--       values were calculated off a resized screenshot rather than the
--       actual source image, so every position shifts slightly.
--   (b) add map_nodes.parent_node_id (self-referential, nullable) and
--       reassign the 10 mini-game nodes that are really sub-games of a
--       single physical pad (Arcade Pad, Ground Games) to their parent.
--       Parented nodes stop rendering as their own pin / fallback-list entry
--       (app-side change) — the parent's popup lists them instead.
--   (c) insert the previously-missing "Gaga Ball" node under Ground Games
--       and link it to its existing (currently unlinked) bingo tile.
--
-- Run this in the Supabase SQL editor against the live project.

-- ---------------------------------------------------------------------------
-- (a) corrected positions (35 nodes)
-- ---------------------------------------------------------------------------
update map_nodes as m
set x_pct = v.x_pct, y_pct = v.y_pct
from (values
    -- Attractions (18)
    ('Arcade Pad',       9.7,  43.7),
    ('Pedal Karts',      9.7,  33.4),
    ('Tractor Ride',     10.5, 23.1),
    ('Mini-Golf',        28.6, 24.2),
    ('Archery',          25.5, 31.6),
    ('Tether Ball',      58.1, 20.5),
    ('Chicken Bowl',     63.9, 22.4),
    ('Axe Throwing',     58.5, 33.8),
    ('Farm Toss',        62.4, 38.7),
    ('Fort Slide',       65.9, 29.1),
    ('Playground',       69.0, 44.1),
    ('Mystery Maze',     71.3, 65.0),
    ('Blaster Balls',    43.7, 67.3),
    ('Ground Games',     47.7, 31.1),
    ('Climbing Wall',    36.8, 35.6),
    ('Slide Tower',      34.3, 30.5),
    ('Rope Maze',        89.9, 80.3),
    ('Soccer Game',      60.8, 57.8),
    -- Services (6)
    ('Ticket Booth',   35.2, 70.2),
    ('Restrooms',      19.1, 47.7),
    ('Party Tents',    31.0, 47.5),
    ('Main Stage',     51.5, 64.4),
    ('Admin Offices',  21.8, 65.3),
    ('Animal Stage',   62.0, 75.0),
    -- Food & Stores (4)
    ('Critter Cafe',          31.3, 59.1),
    ('Granny Ann''s Kitchen', 31.4, 55.9),
    ('Sugar Shack',           33.7, 53.0),
    ('General Store',         26.3, 70.8),
    -- Animals (7)
    ('Small Animals',              57.1, 79.8),
    ('Kangaroos/Wallaroos',        43.7, 83.2),
    ('Goats',                      55.8, 89.5),
    ('Alpacas/Sheep/Pigs',         65.1, 89.4),
    ('Capybaras & Emus',           77.0, 90.1),
    ('Wallaroos (viewing only)',   78.3, 78.7),
    ('Private Event Animal Space', 17.1, 61.6)
) as v(name, x_pct, y_pct)
where m.name = v.name;

-- ---------------------------------------------------------------------------
-- (b) parent_node_id column + child reassignment
-- ---------------------------------------------------------------------------
alter table map_nodes add column if not exists parent_node_id uuid references map_nodes(id) on delete set null;

update map_nodes
set parent_node_id = (select id from map_nodes where name = 'Arcade Pad')
where name in ('Cornhole', 'Cornhole Extreme', 'Horse Hoops', 'Tiki Toss/Ring & Hook');

update map_nodes
set parent_node_id = (select id from map_nodes where name = 'Ground Games')
where name in ('Red White and Blue', 'Pyramid Puzzler', 'Hop Dots', 'Math Maze', 'Right Turn Only');

-- ---------------------------------------------------------------------------
-- (c) Gaga Ball node, parented under Ground Games, linked to its existing
-- (currently unlinked) bingo tile
-- ---------------------------------------------------------------------------
insert into map_nodes (name, category, description, parent_node_id)
select 'Gaga Ball', 'attraction', 'Gaga ball pit.', (select id from map_nodes where name = 'Ground Games')
where not exists (select 1 from map_nodes where name = 'Gaga Ball');

update bingo_tiles
set linked_map_node_id = (select id from map_nodes where name = 'Gaga Ball')
where label = 'Win a round of Gaga Ball' and linked_map_node_id is null;
