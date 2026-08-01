-- CAP Companion App — migration 002: add map_nodes.x_pct/y_pct
--
-- schema.sql uses `create table if not exists`, so re-running it against the
-- already-live map_nodes table was a no-op — x_pct/y_pct never actually got
-- created, which is why GET /map/nodes throws KeyError: 'x_pct'. This
-- migration brings the live table up to date without touching anything else:
--
--   (a) add the x_pct/y_pct columns + their check constraints, if missing
--   (b) backfill positions on the 30 nodes that already exist in the live DB
--   (c) insert the 5 nodes that don't exist in the live DB yet at all
--
-- The other 9 nodes in seed.sql (Cornhole, Cornhole Extreme, Horse Hoops,
-- Tiki Toss/Ring & Hook, Pyramid Puzzler, Hop Dots, Red White and Blue, Math
-- Maze, Right Turn Only) are intentionally left alone here — they have NULL
-- x_pct/y_pct in seed.sql (not yet placed on the hand-drawn map) and are
-- assumed to already exist in the live DB, so there's nothing to backfill.
--
-- Safe to run more than once: column adds, constraint adds, and the insert
-- are all guarded; the update just re-applies the same values.

-- ---------------------------------------------------------------------------
-- (a) columns + constraints
-- ---------------------------------------------------------------------------
alter table map_nodes add column if not exists x_pct double precision;
alter table map_nodes add column if not exists y_pct double precision;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'map_nodes_x_pct_check') then
        alter table map_nodes add constraint map_nodes_x_pct_check
            check (x_pct is null or (x_pct >= 0 and x_pct <= 100));
    end if;

    if not exists (select 1 from pg_constraint where conname = 'map_nodes_y_pct_check') then
        alter table map_nodes add constraint map_nodes_y_pct_check
            check (y_pct is null or (y_pct >= 0 and y_pct <= 100));
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- (b) backfill positions on the 30 nodes that already exist live
-- ---------------------------------------------------------------------------
update map_nodes as m
set x_pct = v.x_pct, y_pct = v.y_pct
from (values
    -- Attractions (18)
    ('Arcade Pad',       11.8, 43.5),
    ('Pedal Karts',      11.8, 33.3),
    ('Tractor Ride',     12.6, 23.1),
    ('Mini-Golf',        30.0, 24.2),
    ('Archery',          27.0, 31.5),
    ('Tether Ball',      58.4, 20.5),
    ('Chicken Bowl',     64.0, 22.4),
    ('Axe Throwing',     58.8, 33.8),
    ('Farm Toss',        62.5, 38.6),
    ('Fort Slide',       65.8, 29.0),
    ('Playground',       68.8, 43.9),
    ('Mystery Maze',     71.0, 64.6),
    ('Blaster Balls',    44.5, 66.9),
    ('Ground Games',     48.3, 31.0),
    ('Climbing Wall',    37.9, 35.4),
    ('Slide Tower',      35.5, 30.4),
    ('Rope Maze',        88.9, 79.7),
    ('Soccer Game',      61.0, 57.5),
    -- Animals (5)
    ('Small Animals',        57.5, 79.3),
    ('Kangaroos/Wallaroos',  44.5, 82.6),
    ('Goats',                56.2, 88.8),
    ('Alpacas/Sheep/Pigs',   65.1, 88.8),
    ('Capybaras & Emus',     76.5, 89.4),
    -- Services & Food (7)
    ('Ticket Booth',  36.4, 69.7),
    ('Restrooms',      20.9, 47.4),
    ('Party Tents',   32.3, 47.2),
    ('Main Stage',    52.0, 63.9),
    ('Critter Cafe',  32.7, 58.7),
    ('Sugar Shack',   34.9, 52.7),
    ('General Store', 27.8, 70.4)
) as v(name, x_pct, y_pct)
where m.name = v.name;

-- ---------------------------------------------------------------------------
-- (c) insert the 5 nodes missing from the live DB entirely
-- ---------------------------------------------------------------------------
insert into map_nodes (name, category, description, x_pct, y_pct) values
    ('Admin Offices',              'service', 'Park administrative offices.',                          23.5, 64.9),
    ('Animal Stage',               'service', 'Scheduled animal show stage.',                          62.1, 74.5),
    ('Granny Ann''s Kitchen',      'food',    'Kitchen and dining stand.',                              32.7, 55.5),
    ('Wallaroos (viewing only)',   'animal',  'Wallaroo viewing overlook (viewing only, no entry).',   77.8, 78.2),
    ('Private Event Animal Space', 'animal',  'Reserved animal encounter space for private events.',   19.0, 61.2)
on conflict (name) do nothing;
