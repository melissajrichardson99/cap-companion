-- CAP Companion App — migration 047: Farm Toss scores, Cornhole Mini Golf
-- pin, Tractor Ride - East/West, Bee Maze, and a coming-soon building
--
-- 1. Farm Toss: a throw can score 2, 3, 4, 5 or 6 (plus Miss). The sheet's
--    buttons come straight from game_score_events, so this only adds the
--    4-Point Ring and 5-Point Ring rows and moves 6-Point Ring to the end
--    (sort_order 5) so the buttons stay ascending. Miss keeps sort_order 99.
--    score_entries point at an event's id, and the existing 2/3/6/Miss rows
--    keep their ids, labels and point values, so every stored entry and
--    total is unchanged.
--
-- 2. Cornhole Mini Golf: the provisional pin from migration 043 (76, 70)
--    moves to the bottom-right corner, measured by Melissa on her blank map
--    at (87.7, 97.4). x_pct/y_pct are percent of the map image's width and
--    height from its top-left corner. y is nudged up 0.1 to 97.3: at a
--    390 px phone the map is 371 px tall and a pin is 20 px, so at 97.4 the
--    pin's box ran 0.35 px past the bottom edge, which clips.
--
-- 3. Tractor Ride: there are two stations. The map has east at the top and
--    west at the bottom. The existing node (10.5, 23.1, near the top) is
--    the east station and is renamed "Tractor Ride - East" -- same id and
--    position, so its node_visits, map_node_visit_events, Bingo tile link
--    and any QR location carry over (all of them are keyed by id). A new
--    "Tractor Ride - West" is copied from it at (92.6, 86.4), near the
--    bottom.
--    An earlier draft of this file named the two the other way round and
--    was run on dev only (never production). Step 3a undoes that first, so
--    running this file on either database ends in the same state.
--
-- 4. Bee Maze: a new walk-through attraction at (71.4, 52.9).
--
-- 5. "New Building (Coming Soon)": a facility under construction at
--    (43.9, 77.2). New column map_nodes.coming_soon marks it:
--      - the Map shows a construction icon and no Mark Visited button, and
--        POST /map/nodes/{id}/visit refuses it (409), so it gets no visit,
--        no heatmap event and no coins;
--      - it is not counted by the Map Exploration bonus (it is also closed);
--      - it has no Bingo tile and is left out of the staff heatmap and the
--        QR location picker.
--    It starts closed. When it opens, staff press "Open" on the Staff Page
--    Attractions tab: that sets is_open = true and clears coming_soon in
--    the same update, so it becomes a normal attraction. Renaming it is
--    one statement (the name lives only in this row):
--        update map_nodes set name = '<new name>', description = '<text>'
--        where name = 'New Building (Coming Soon)';
--
-- Map Exploration needs every open, not-coming-soon top-level node. That
-- goes from 36 to 38 (+Tractor Ride - West, +Bee Maze; the building is
-- excluded). The threshold is not stored anywhere -- it is computed from
-- the rows on every visit. Sessions that already got the bonus keep it:
-- it is a one-time coin_awards row that is never revoked.
--
-- The backend caches map_nodes for 60 s and game_score_events for 5 min
-- (app/reference_cache.py). Direct SQL like this does not clear the cache,
-- so the changes appear within those times (or at once after a backend
-- restart). Staff-page actions clear the cache themselves.
--
-- Not a new table and no new function, so no RLS/grant changes: map_nodes
-- and game_score_events already have RLS on (046) and only service_role
-- uses them. Adding a column with a constant default is a metadata-only
-- change in Postgres.
--
-- Can run before or after the backend deploy: the new backend reads
-- coming_soon with a default of false, and the old backend ignores it.
--
-- Safe to run more than once: the column uses "if not exists", inserts are
-- skipped when the name (or, for the new nodes, the position) already
-- exists, the renames only match the old names (or the dev draft's), and the
-- updates set fixed values. Nothing is deleted.

-- ---------------------------------------------------------------------------
-- Schema: map_nodes.coming_soon
-- ---------------------------------------------------------------------------
alter table map_nodes add column if not exists coming_soon boolean not null default false;

comment on column map_nodes.coming_soon is
    'Under construction / not open yet (migration 047). No visits, not counted by Map Exploration, '
    'not on the heatmap. Opening the node from the Staff Page clears it.';

-- ---------------------------------------------------------------------------
-- 1. Farm Toss: 2, 3, 4, 5, 6 + Miss
-- ---------------------------------------------------------------------------
insert into game_score_events (game_id, label, point_value, sort_order)
select g.id, e.label, e.point_value, e.sort_order
from scoring_games g,
(values
    ('4-Point Ring', 4, 3),
    ('5-Point Ring', 5, 4)
) as e(label, point_value, sort_order)
where g.name = 'Farm Toss'
on conflict (game_id, label) do nothing;

update game_score_events
set sort_order = 5
where label = '6-Point Ring'
  and sort_order <> 5
  and game_id = (select id from scoring_games where name = 'Farm Toss');

-- ---------------------------------------------------------------------------
-- 2. Cornhole Mini Golf: bottom-right corner
-- ---------------------------------------------------------------------------
update map_nodes set x_pct = 87.7, y_pct = 97.3 where name = 'Cornhole Mini Golf';

-- ---------------------------------------------------------------------------
-- 3. Tractor Ride - East (rename) and Tractor Ride - West (new)
-- ---------------------------------------------------------------------------
-- 3a. Earlier draft (dev only): the new node at 92.6/86.4 was called East.
--     Park it under a temporary name so the original node can take "East"
--     without breaking the unique name. No-op on production.
update map_nodes
set name = 'Tractor Ride - West (047 rename)'
where name = 'Tractor Ride - East'
  and x_pct = 92.6 and y_pct = 86.4;

-- 3b. The original node becomes East: same id, same position. Matches the
--     original name, or the earlier draft's "West" on dev.
update map_nodes
set name = 'Tractor Ride - East'
where name in ('Tractor Ride', 'Tractor Ride - West')
  and not (x_pct = 92.6 and y_pct = 86.4)
  and not exists (select 1 from map_nodes where name = 'Tractor Ride - East');

-- 3c. Dev only: the node parked in 3a becomes West (keeps its id).
update map_nodes
set name = 'Tractor Ride - West'
where name = 'Tractor Ride - West (047 rename)';

-- 3d. New West station, copied from East (skipped if a node is already there).
insert into map_nodes (name, category, description, x_pct, y_pct, is_open)
select 'Tractor Ride - West',
       e.category,
       'Guided tractor ride around the park. There are two tractor ride stations; this is the west one.',
       92.6, 86.4,
       e.is_open
from map_nodes e
where e.name = 'Tractor Ride - East'
  and not exists (select 1 from map_nodes where x_pct = 92.6 and y_pct = 86.4)
on conflict (name) do nothing;

-- 3e. Descriptions (fixed values).
update map_nodes
set description = 'Guided tractor ride around the park. There are two tractor ride stations; this is the east one.'
where name = 'Tractor Ride - East';

update map_nodes
set description = 'Guided tractor ride around the park. There are two tractor ride stations; this is the west one.'
where name = 'Tractor Ride - West';

-- ---------------------------------------------------------------------------
-- 4. Bee Maze (new)
-- ---------------------------------------------------------------------------
insert into map_nodes (name, category, description, x_pct, y_pct)
select 'Bee Maze', 'attraction', 'A maze to walk through.', 71.4, 52.9
where not exists (select 1 from map_nodes where x_pct = 71.4 and y_pct = 52.9)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 5. New Building (Coming Soon) (new, closed, coming soon)
-- ---------------------------------------------------------------------------
insert into map_nodes (name, category, description, x_pct, y_pct, is_open, coming_soon)
select 'New Building (Coming Soon)', 'service', 'Under construction. Coming soon.', 43.9, 77.2, false, true
where not exists (select 1 from map_nodes where x_pct = 43.9 and y_pct = 77.2)
on conflict (name) do nothing;
