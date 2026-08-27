-- CAP Companion App — migration 030: Per-Device Sessions Phase 6b
-- (Scavenger Hunt) — FINAL PHASE of the Per-Device Sessions migration
--
-- Investigation finding: unlike Bingo/Map (Phases 3/6a), hunt_progress's
-- existing grain is already exactly right for per-session tracking. It was
-- one row per hunt_characters.id (5 rows total, `unique (character_id)`) --
-- there was never a "shared layout" table analogous to bingo_tiles/map_nodes
-- that a junction table needed to sit alongside. Turning it into one row per
-- (session, character) pair is a straightforward direct ALTER, the same
-- pattern as migrations 024/025 (Phases 1-2: coin_awards, collectible_
-- redemptions, puzzle_attempts, score_sheet_sessions), not a new junction
-- table like Phase 3/6a needed.
--
-- hunt_characters/hunt_challenges (the character definitions/theming and
-- challenge content) are NOT touched here -- they stay global reference
-- content, same as Bingo's tile layout (migration 029) and the map node
-- catalog (migration 026).
--
-- Clean cutover, not a backfill: same reasoning as every prior Per-Device-
-- Sessions migration -- this is a POC with no real guest data worth
-- preserving. Existing hunt_progress rows are wiped before the NOT NULL
-- column is added (there's no meaningful way to attribute an old global
-- character-found/completed state to any one session anyway). The old
-- single-column `unique (character_id)` constraint (auto-named
-- hunt_progress_character_id_key -- it was declared inline as `character_id
-- uuid not null unique references ...`) is dropped and replaced with
-- `unique (session_id, character_id)`: the new grain is one progress row per
-- session per character, not one per character globally. Rows are no longer
-- pre-seeded (seed.sql's `insert into hunt_progress (character_id) select
-- ...` is removed) -- like session_tile_completions, a progress row is now
-- created lazily, the first time a given session unlocks or completes a
-- challenge for that character (see app/services/hunt.py's
-- _get_or_create_progress).
--
-- No grant/alter-default-privileges block needed, same reasoning as
-- migrations 024/025: ALTER TABLE ADD COLUMN on a table already granted
-- service_role privileges (migration 017) is a table-level grant, not
-- column-level. Verify with a live round-trip anyway per this project's
-- standing "queries silently return empty/stale, no error" gotcha.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: the delete is idempotent (no-op once empty),
-- the constraint drop/column add/constraint add are all guarded.

delete from hunt_progress;

alter table hunt_progress drop constraint if exists hunt_progress_character_id_key;

alter table hunt_progress
    add column if not exists session_id uuid not null references device_sessions(id);

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'hunt_progress_session_id_character_id_key'
    ) then
        alter table hunt_progress
            add constraint hunt_progress_session_id_character_id_key unique (session_id, character_id);
    end if;
end $$;

create index if not exists hunt_progress_session_id_idx on hunt_progress(session_id);
create index if not exists hunt_progress_character_id_idx on hunt_progress(character_id);
