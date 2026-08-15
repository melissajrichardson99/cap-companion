-- CAP Companion App — migration 016: swap Admin Offices / Private Event
-- Animal Space map positions
--
-- Migration 003 gave these two nodes each other's correct x_pct/y_pct
-- (yellow-square legend #5 and orange-circle legend #7 landed swapped on the
-- map) -- confirmed against a desktop screenshot. Swap them back. Safe to
-- run more than once.

update map_nodes set x_pct = 17.1, y_pct = 61.6 where name = 'Admin Offices';
update map_nodes set x_pct = 21.8, y_pct = 65.3 where name = 'Private Event Animal Space';
