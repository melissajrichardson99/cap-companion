-- CAP Companion App — migration 041: Staff Visit Heatmap (Phase 1) — raw
-- visit event log
--
-- node_visits (migration 026) is a per-session *status* table: one row per
-- (session_id, node_id), upserted with ignore_duplicates, so a repeat visit
-- to the same node never leaves a trace and visited_at stays pinned to the
-- first visit. It's also deleted by Reset Session and the 14-day session
-- cleanup job. Neither property works for a foot-traffic heatmap, which
-- needs every visit occurrence over time.
--
-- map_node_visit_events is that occurrence log: app/services/map_bingo.py's
-- visit_node inserts one row per successful POST /map/nodes/{id}/visit call,
-- never deduplicated, alongside (not instead of) the existing node_visits
-- upsert. GET /staff/heatmap (app/services/heatmap.py) counts these rows
-- grouped by source_id.
--
-- Deliberately anonymous: no session_id or guest_id column, so nothing here
-- is ever tied back to a device or guest account -- pure aggregate counting,
-- consistent with the Privacy Policy's existing aggregate-usage disclosure.
-- That also means Reset Session / session cleanup never touch this table.
--
-- source_type/source_id are generic (not a map_node_id FK) on purpose:
-- Phase 2 will log QR-scan events for Hunt characters, Animals, Scoring
-- games, and Puzzles into this same table under their own source_type
-- values. source_id is therefore plain text with no FK -- each source_type
-- resolves its own ids. Phase 1 only ever writes source_type = 'map_node'
-- with source_id = map_nodes.id.
--
-- Run this in the Supabase SQL editor against the live project (per the
-- project's standing gotcha, schema.sql edits alone never reach the live
-- DB). Safe to run more than once: the table/index creates are guarded and
-- the grant is idempotent.

create table if not exists map_node_visit_events (
    id          uuid primary key default gen_random_uuid(),
    source_type text not null default 'map_node',
    source_id   text not null,
    visited_at  timestamptz not null default now()
);

-- Every heatmap query filters by source_type + a visited_at window first.
create index if not exists map_node_visit_events_type_visited_at_idx
    on map_node_visit_events(source_type, visited_at);

-- New table: explicit grant, same as migrations 029/035 -- don't rely on
-- 017's default privileges alone (verified with a live insert -> select
-- round-trip, see the Heatmap ticket's verification notes).
grant all privileges on table map_node_visit_events to service_role;
