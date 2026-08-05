-- CAP Companion App — migration 004: insert Phase 2 minigame rows
--
-- Same pattern as the grants/positions/parent-node migrations before this one:
-- seed.sql was updated with the 5 Phase 2 minigames but never actually run
-- against the live database, so map_bingo._minigame_pool() (which queries the
-- live `minigames` table, not seed.sql) only ever draws the 5 Phase 1 games.
-- Confirmed via the REST API on 2026-08-01: the live table has exactly the 5
-- Phase 1 rows and none of these.
--
-- name values match GAME_SLUGS in frontend/src/components/MinigameOverlay.tsx
-- exactly — MinigameOverlay looks up the exported Web build by Minigame.name,
-- so a mismatch here would silently fall back to the stub notice instead of
-- loading the built game.
--
-- Run this in the Supabase SQL editor against the live project.

insert into minigames (name, engine_group, theme, target_duration_seconds, phase) values
    ('Mini Platformer',   'standalone',  'kangaroo', 30, 2),
    ('Obstacle Dodge',    'auto_scroll', 'alpaca',   30, 2),
    ('Digital Ring Toss', 'standalone',  'none',     30, 2),
    ('Bug Net Swipe',     'standalone',  'none',     30, 2),
    ('Sort the Species',  'auto_scroll', 'none',     30, 2)
on conflict (name) do nothing;
