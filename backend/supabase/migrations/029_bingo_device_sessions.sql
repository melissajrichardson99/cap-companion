-- CAP Companion App — migration 029: Per-Device Sessions Phase 6a (Bingo)
--
-- The Bingo tile *layout* (which of the 25 curated activities sits in which
-- grid position -- bingo_cards/bingo_tiles' row_index/col_index/label/
-- linked_map_node_id) stays exactly as-is: one single, shared, global layout
-- every family sees. What moves per-session is purely the completion
-- tracking -- which tiles a given family has checked off -- mirroring the
-- map_nodes/node_visits split from migration 026 (Phase 3): the layout table
-- is untouched, and a new per-session junction table takes over the
-- completion half.
--
-- No new session_bingo_progress flags table for milestone-achievement
-- (achieved lines / X / blackout): app/services/milestone.py's
-- achieved_milestones() computes those live from session_tile_completions
-- instead, same "don't introduce a new class of state that can drift"
-- reasoning that kept map_nodes.is_open the only column left standing after
-- migration 026 -- bingo_cards.milestone_lines/milestone_x/milestone_blackout
-- were themselves nothing more than a cache of that same computation, now
-- redundant once completed_indices is read live per session instead of
-- global bingo_tiles.completed.
--
-- Clean cutover, not a backfill: same reasoning as every prior
-- Per-Device-Sessions migration -- this is a POC with no real guest data
-- worth preserving. bingo_tiles.completed/completed_at and bingo_cards'
-- three milestone columns are dropped outright once session_tile_completions
-- exists to replace what they tracked; there's no meaningful way to
-- attribute old global completions to any one session anyway.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: the table create is guarded, the grant is
-- idempotent, and the column drops are guarded (`if exists`).

create table if not exists session_tile_completions (
    id           uuid primary key default gen_random_uuid(),
    session_id   uuid not null references device_sessions(id),
    tile_id      uuid not null references bingo_tiles(id) on delete cascade,
    completed_at timestamptz not null default now(),
    unique (session_id, tile_id)
);

create index if not exists session_tile_completions_session_id_idx on session_tile_completions(session_id);
create index if not exists session_tile_completions_tile_id_idx on session_tile_completions(tile_id);

grant all privileges on table session_tile_completions to service_role;

alter table bingo_tiles drop column if exists completed;
alter table bingo_tiles drop column if exists completed_at;

alter table bingo_cards drop column if exists milestone_lines;
alter table bingo_cards drop column if exists milestone_x;
alter table bingo_cards drop column if exists milestone_blackout;
