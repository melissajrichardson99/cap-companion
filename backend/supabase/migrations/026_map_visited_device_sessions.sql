-- CAP Companion App — migration 026: Per-Device Sessions Phase 3
-- (Map node visited-status)
--
-- Unlike Phase 1/2, map_nodes.state can't just gain a session_id column --
-- it represented visited-status as a single column directly on the node,
-- which only worked with one global visitor. Now that many concurrent
-- sessions each need independent visited/not-visited status for the same
-- node, visited-status moves into a new dedicated table recording
-- (session, node) pairs instead. map_nodes.is_open is untouched by this
-- migration -- it's genuinely global, staff-controlled data (see migration
-- 019), not guest visit progress.
--
-- map_nodes.state was created in schema.sql as a plain `text ... check
-- (state in ('not_visited', 'visited', 'closed'))` column, not a dedicated
-- Postgres enum type -- schema.sql is this project's source of truth for
-- what each migration actually applied (every migration since 002 has kept
-- it in sync), and no migration between then and now touched this column's
-- type. So dropping the column also drops its check constraint with it;
-- there is no separate enum type to drop.
--
-- Clean cutover, not a backfill: same reasoning as migrations 024/025 --
-- this is a POC with no real guest data worth preserving. There's no
-- meaningful way to backfill the old global `state` onto per-session rows
-- anyway (it was never attributable to a session), so the column is simply
-- dropped after node_visits is created -- no data moves from one to the
-- other.
--
-- node_visits is a genuinely new table, not an ALTER on an existing one --
-- same caution as migration 023's device_sessions and migration 024/025's
-- first-new-table reasoning, not migration 019's map_nodes.is_open-style
-- ALTER reasoning (migration 017's `alter default privileges` only covers
-- tables created afterward by the same role that ran that statement, so it
-- can't be assumed to already cover this). Granting explicitly below and
-- verifying with a live round-trip rather than assuming.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: the table create is guarded, the grant is
-- idempotent, and the column drop is guarded (`if exists`).

create table if not exists node_visits (
    id          uuid primary key default gen_random_uuid(),
    session_id  uuid not null references device_sessions(id),
    node_id     uuid not null references map_nodes(id) on delete cascade,
    visited_at  timestamptz not null default now(),
    unique (session_id, node_id)
);

create index if not exists node_visits_session_id_idx on node_visits(session_id);
create index if not exists node_visits_node_id_idx on node_visits(node_id);

grant all privileges on table node_visits to service_role;

alter table map_nodes drop column if exists state;
