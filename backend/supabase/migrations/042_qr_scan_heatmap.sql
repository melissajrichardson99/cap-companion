-- CAP Companion App — migration 042: Staff Visit Heatmap (Phase 2) — QR
-- scan events + a map location for every QR destination
--
-- 1. map_node_visit_events gains QR-scan rows alongside migration 041's
--    check-ins. source_type tells them apart ('map_node' = check-in,
--    'qr_scan' = scan); source_id keeps meaning "the map node" for both, so
--    aggregation stays per node. A scan of a destination with no mapped
--    location is still recorded, with source_id null, so staff can see the
--    gap (the heatmap page shows an unmapped count). destination_type /
--    destination_id record what was scanned (e.g. 'animal' / 'goat'): never
--    a session or guest id, so the table stays fully anonymous (no Privacy
--    Policy change). Check-in rows leave both null.
--
-- 2. Each QR destination type gets a nullable map-node reference:
--    - hunt_characters.map_node_id, scoring_games.map_node_id: new columns.
--    - Puzzle challenges: none needed -- puzzles.map_node_id (schema.sql)
--      already exists and is populated; a challenge's location is its
--      puzzle's.
--    - Our Animals is static frontend content (no table), so a small
--      animal_map_locations table keyed by slug, mirroring ANIMAL_SLUGS.
--    The reference is the *specific* node, including child nodes (e.g.
--    Cornhole under Arcade Pad); GET /staff/heatmap rolls child counts up
--    into the top-level pin that actually renders as a dot.
--
-- 3. Seeds the mappings Melissa confirmed on 2026-10-10. Anything uncertain
--    is left null (wallaby, sloth, porcupine animals; Snake and Sloth Hunt
--    characters). Staff can fix any of these from the QR Code Directory
--    without another migration.
--
-- Run this in the Supabase SQL editor against the live project (schema.sql
-- edits alone never reach the live DB). Safe to run more than once: every
-- DDL statement is guarded, and the seeds only fill rows that are still
-- null, so re-running never overwrites a mapping staff have since edited.

-- ---------------------------------------------------------------------------
-- 1. Event log
-- ---------------------------------------------------------------------------
alter table map_node_visit_events alter column source_id drop not null;
alter table map_node_visit_events add column if not exists destination_type text;
alter table map_node_visit_events add column if not exists destination_id text;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'map_node_visit_events_source_shape') then
        alter table map_node_visit_events add constraint map_node_visit_events_source_shape check (
            (source_type = 'map_node' and source_id is not null)
            or (source_type = 'qr_scan' and destination_type is not null and destination_id is not null)
        );
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Location references
-- ---------------------------------------------------------------------------
alter table hunt_characters
    add column if not exists map_node_id uuid references map_nodes(id) on delete set null;
alter table scoring_games
    add column if not exists map_node_id uuid references map_nodes(id) on delete set null;

create table if not exists animal_map_locations (
    -- Matches an ANIMAL_SLUGS entry (app/services/collectibles.py) /
    -- frontend/src/animalContent.ts slug. No FK target exists for it.
    animal_slug text primary key,
    map_node_id uuid references map_nodes(id) on delete set null
);

grant all privileges on table animal_map_locations to service_role;

-- ---------------------------------------------------------------------------
-- 3. Seeds (by node name, which map_nodes enforces unique)
-- ---------------------------------------------------------------------------
insert into animal_map_locations (animal_slug, map_node_id)
select v.slug, n.id
from (values
    ('alpaca', 'Alpacas/Sheep/Pigs'),
    ('pig', 'Alpacas/Sheep/Pigs'),
    ('capybara', 'Capybaras & Emus'),
    ('emu', 'Capybaras & Emus'),
    ('goat', 'Goats'),
    ('kangaroo', 'Kangaroos/Wallaroos'),
    ('wallaby', null),
    ('sloth', null),
    ('porcupine', null)
) as v(slug, node_name)
left join map_nodes n on n.name = v.node_name
on conflict (animal_slug) do nothing;

update hunt_characters h
set map_node_id = n.id
from (values
    ('Kangaroo', 'Kangaroos/Wallaroos'),
    ('Pig', 'Alpacas/Sheep/Pigs'),
    ('Capybara', 'Capybaras & Emus')
) as v(character_name, node_name)
join map_nodes n on n.name = v.node_name
where h.name = v.character_name and h.map_node_id is null;

update scoring_games g
set map_node_id = n.id
from (values
    ('Farm Toss', 'Farm Toss'),
    ('Horse Hoops', 'Horse Hoops'),
    ('Cornhole', 'Cornhole'),
    ('Cornhole Extreme', 'Cornhole Extreme'),
    ('Tiki Toss / Ring & Hook', 'Tiki Toss/Ring & Hook')
) as v(game_name, node_name)
join map_nodes n on n.name = v.node_name
where g.name = v.game_name and g.map_node_id is null;
